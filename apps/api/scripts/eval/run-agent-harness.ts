/**
 * Agent Harness — multi-agent structural eval for the provision subagents.
 *
 * Runs the mapping-agent, audit-defense, and credit-miner agents against the
 * fixture set in fixtures/agent-harness/ and asserts STRUCTURE only:
 *   - every output zod-validates and lands a terminal status
 *   - key fields are present, typed, and finite
 *   - fallbacks (provider errors / zod rejections) are handled gracefully
 *     and recorded, never a crash
 *
 * The deterministic tax engine remains the source of truth for amounts; this
 * harness never asserts tax math.
 *
 * Modes (mirrors run-ai-mapping-eval.ts):
 *   dry-run  — default; lists fixtures, exits 0 (no provider needed)
 *   mocked   — AI_EVAL_MODE=mocked | MOCK_AI=1; scripted responses through
 *              the REAL zod schemas; includes a malformed-response fixture
 *              proving zod rejection -> fallback, not crash
 *   real     — AI_EVAL_MODE=real; calls the live agents (requires AI_API_KEY)
 *
 * Exit codes: 0 PASS (dry-run/mocked always pass unless the harness crashes),
 * 0 real-mode PASS, 1 real-mode FAIL (fallback rate > AGENT_HARNESS_FALLBACK_THRESHOLD,
 * default 25%), 1 structural failure in any mode, 1 fixture-set integrity error.
 *
 * Trend history: append-only JSONL at agent-harness-trend.jsonl (git-ignored).
 * Provider/model names are printed in real mode only; API keys are never printed.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMappingAgent } from '../../src/agent/subagents/mapping-agent.js';
import { draftAuditMemo } from '../../src/agent/subagents/audit-defense.js';
import { mineCredits, creditIdentificationSchema } from '../../src/agent/subagents/credit-miner.js';
import { getAiModel, isAiConfigured } from '../../src/config/ai.js';
import type { AuditDefenseInput, AuditDefenseResult } from '../../src/agent/subagents/audit-defense.js';
import { recordTrendLine, printRecentRuns } from './agent-harness-trend.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'agent-harness');

const MIN_FIXTURES = 15;
const MAX_FIXTURES = 20;
const DEFAULT_FALLBACK_THRESHOLD = 0.25;

type Mode = 'dry-run' | 'mocked' | 'real';

interface LedgerAccount {
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountType: string;
  detailType?: string;
  balance: number;
  currency: string;
}

interface HarnessFixture {
  _fixtureId: string;
  _meta: {
    description: string;
    jurisdiction: string;
    entityType: string;
    scenario: string;
    harness?: { mockCreditConfidence?: 'numeric' | 'string-label' };
  };
  tenant: { id: string; name: string };
  fiscalYear: number;
  period: string;
  ledgerCurrency: string;
  legalEntities: Array<{ name: string; jurisdiction: string; entityType: string }>;
  trialBalance: LedgerAccount[];
  provisionSummary: AuditDefenseInput;
  expectations: { mapping: string; audit: string; credit: string };
}

interface AgentRun {
  ok: boolean;
  fallback: boolean;
  checks: number;
  failures: number;
  detail: string[];
}

interface FixtureResult {
  fixtureId: string;
  mapping: AgentRun;
  audit: AgentRun;
  credit: AgentRun;
}

interface AgentTotals {
  ok: number;
  total: number;
  fallbacks: number;
  checks: number;
  failures: number;
}

const BOOK_TREATMENTS = new Set(['permanent', 'temporary', 'no_diff']);

// ── Mode resolution ──

function resolveMode(): Mode {
  const mode = (process.env.AI_EVAL_MODE ?? '').toLowerCase();
  if (process.env.MOCK_AI === '1') return 'mocked';
  const configured = isAiConfigured();
  if (mode === 'real' && !configured) {
    console.error('AI_EVAL_MODE=real requires a configured AI provider (AI_API_KEY / AI_PROVIDER).');
    process.exit(1);
  }
  if (mode === 'mocked') return 'mocked';
  if (mode === 'dry-run') return 'dry-run';
  if (configured) {
    console.log('AI provider configured; defaulting to real mode (set AI_EVAL_MODE=dry-run|mocked to override).');
    return 'real';
  }
  return 'dry-run';
}

function fallbackThreshold(): number {
  const raw = process.env.AGENT_HARNESS_FALLBACK_THRESHOLD;
  if (!raw) return DEFAULT_FALLBACK_THRESHOLD;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.error(`AGENT_HARNESS_FALLBACK_THRESHOLD must be a fraction in [0,1] (got "${raw}").`);
    process.exit(1);
  }
  return parsed;
}

function fixtureLimit(): number {
  const raw = process.env.AGENT_HARNESS_FIXTURE_LIMIT;
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`AGENT_HARNESS_FIXTURE_LIMIT must be a positive integer (got "${raw}").`);
    process.exit(1);
  }
  return parsed;
}

// ── Fixtures ──

function loadFixtures(): HarnessFixture[] {
  if (!existsSync(FIXTURES_DIR)) {
    console.error(`Fixture directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length < MIN_FIXTURES || files.length > MAX_FIXTURES) {
    console.error(
      `Fixture count ${files.length} out of range [${MIN_FIXTURES}-${MAX_FIXTURES}]. ` +
      `Refusing to run an under- or over-provisioned harness.`,
    );
    process.exit(1);
  }

  const fixtures: HarnessFixture[] = [];
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), 'utf8')) as HarnessFixture;
    if (!fixture._fixtureId || fixture._fixtureId !== file.replace(/\.json$/, '')) {
      console.error(`Fixture ${file}: _fixtureId must match the filename.`);
      process.exit(1);
    }
    if (!fixture.tenant?.id || !fixture.tenant?.name) {
      console.error(`Fixture ${file}: missing tenant.id/tenant.name.`);
      process.exit(1);
    }
    if (!Array.isArray(fixture.trialBalance) || fixture.trialBalance.length === 0) {
      console.error(`Fixture ${file}: trialBalance must be a non-empty array.`);
      process.exit(1);
    }
    if (!fixture.provisionSummary?.entityName) {
      console.error(`Fixture ${file}: provisionSummary.entityName is required.`);
      process.exit(1);
    }
    if (!fixture.expectations || !fixture.expectations.mapping || !fixture.expectations.audit || !fixture.expectations.credit) {
      console.error(`Fixture ${file}: expectations.mapping/audit/credit must all be non-empty.`);
      process.exit(1);
    }
    fixtures.push(fixture);
  }
  return fixtures;
}

// ── Structural assertions (single source of truth for every mode) ──

function check(run: AgentRun, ok: boolean, message: string): void {
  run.checks++;
  if (!ok) {
    run.failures++;
    run.detail.push(message);
  }
}

function newRun(): AgentRun {
  return { ok: true, fallback: false, checks: 0, failures: 0, detail: [] };
}

function finalize(run: AgentRun): AgentRun {
  run.ok = run.failures === 0 && !run.fallback;
  return run;
}

function assertMappingOutput(run: AgentRun, mappings: MappingEntry[]): void {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    check(run, false, 'no taxMappings produced');
    return;
  }
  for (const m of mappings) {
    check(run, typeof m.accountId === 'string' && m.accountId.length > 0, `mapping ${m.accountId}: missing accountId`);
    check(run, typeof m.taxAccountType === 'string' && m.taxAccountType.trim().length > 0, `mapping ${m.accountId}: taxAccountType missing`);
    check(run, BOOK_TREATMENTS.has(m.bookTreatment), `mapping ${m.accountId}: bookTreatment "${m.bookTreatment}" not in {permanent,temporary,no_diff}`);
    check(run, typeof m.confidenceScore === 'number' && Number.isFinite(m.confidenceScore) && m.confidenceScore >= 0 && m.confidenceScore <= 1, `mapping ${m.accountId}: confidenceScore must be a number in [0,1]`);
    check(run, typeof m.ircSection === 'string' && m.ircSection.trim().length > 0, `mapping ${m.accountId}: ircSection missing`);
    check(run, typeof m.explanation === 'string' && m.explanation.trim().length > 0, `mapping ${m.accountId}: explanation missing`);
  }
}

function assertAuditOutput(run: AgentRun, memo: AuditDefenseResult): void {
  check(run, typeof memo.executiveSummary === 'string' && memo.executiveSummary.trim().length > 0, 'executiveSummary missing');
  check(run, Array.isArray(memo.etrWalk), 'etrWalk must be an array');
  check(run, Array.isArray(memo.technicalMemos), 'technicalMemos must be an array');
  check(run, Array.isArray(memo.riskFlags), 'riskFlags must be an array');
  check(run, typeof memo.qualityScore === 'number' && Number.isFinite(memo.qualityScore), 'qualityScore must be a finite number');
  if (Array.isArray(memo.etrWalk)) {
    for (const line of memo.etrWalk) {
      check(run, typeof line.description === 'string' && line.description.length > 0, 'etrWalk line: description missing');
      check(run, typeof line.amount === 'number' && Number.isFinite(line.amount), 'etrWalk line: amount not finite');
      check(run, typeof line.rateImpactPercent === 'number' && Number.isFinite(line.rateImpactPercent), 'etrWalk line: rateImpactPercent not finite');
      check(run, typeof line.narrative === 'string' && line.narrative.length > 0, 'etrWalk line: narrative missing');
    }
  }
  if (Array.isArray(memo.technicalMemos)) {
    for (const t of memo.technicalMemos) {
      check(run, typeof t.title === 'string' && t.title.length > 0, 'technical memo: title missing');
      check(run, typeof t.ircSection === 'string' && t.ircSection.length > 0, 'technical memo: ircSection missing');
      check(run, typeof t.amount === 'number' && Number.isFinite(t.amount), 'technical memo: amount not finite');
      check(run, ['low', 'medium', 'high'].includes(t.riskLevel), `technical memo: riskLevel "${t.riskLevel}" invalid`);
    }
  }
  if (Array.isArray(memo.riskFlags)) {
    for (const flag of memo.riskFlags) {
      check(run, ['low', 'medium', 'high'].includes(flag.severity), `risk flag: severity "${flag.severity}" invalid`);
      check(run, typeof flag.description === 'string' && flag.description.length > 0, 'risk flag: description missing');
    }
  }
}

function assertCreditOutput(run: AgentRun, credit: CreditResultLike, fixture: HarnessFixture): void {
  check(run, typeof credit.success === 'boolean', 'credit result missing success flag');
  const rdPresent = fixture.trialBalance.some((a) => /rd|research|lab|prototype|engineering/i.test(a.accountName));
  if (credit.rdCredit) {
    check(run, Number.isFinite(credit.rdCredit.qualifiedResearchExpenses) && credit.rdCredit.qualifiedResearchExpenses >= 0, `rdCredit.qualifiedResearchExpenses must be finite and >= 0 (got ${credit.rdCredit.qualifiedResearchExpenses})`);
    if (!rdPresent) {
      // Allow the agent to have identified R&D where we did not label it, but never a negative amount.
      check(run, credit.rdCredit.qualifiedResearchExpenses >= 0, 'negative qualifying expenditure');
    }
  }
  check(run, Number.isFinite(credit.summary?.totalQualifiedExpenses) && credit.summary.totalQualifiedExpenses >= 0, 'summary.totalQualifiedExpenses must be finite and >= 0');
  if (Array.isArray(credit.energyCredits)) {
    for (const e of credit.energyCredits) {
      check(run, typeof e.type === 'string' && e.type.length > 0, 'energy credit: type missing');
      check(run, Number.isFinite(e.estimatedCredit) && e.estimatedCredit >= 0, `energy credit: estimatedCredit not finite/negative (${e.estimatedCredit})`);
      check(run, ['high', 'medium', 'low'].includes(e.confidence), `energy credit: confidence "${e.confidence}" invalid`);
    }
  }
}

interface MappingEntry {
  accountId: string;
  taxAccountType: string;
  bookTreatment: 'permanent' | 'temporary' | 'no_diff';
  confidenceScore: number;
  ircSection: string;
  explanation: string;
}

interface CreditResultLike {
  success: boolean;
  rdCredit: { qualifiedResearchExpenses: number } | null;
  energyCredits: Array<{ type: string; estimatedCredit: number; confidence: string }>;
  summary: { totalQualifiedExpenses: number };
}

// ── Mocked mode: scripted responses through the REAL schemas ──

function mockMapping(fixture: HarnessFixture): MappingEntry[] {
  return fixture.trialBalance.map((a) => ({
    accountId: a.accountId,
    taxAccountType: 'tax_deductible_expense',
    bookTreatment: 'no_diff' as const,
    confidenceScore: 0.99,
    ircSection: 'Sec 162',
    explanation: 'scripted mock (harness mocked mode)',
  }));
}

function mockAudit(fixture: HarnessFixture): AuditDefenseResult {
  const s = fixture.provisionSummary;
  return {
    executiveSummary: `Scripted audit defense summary for ${s.entityName} (${s.period}).`,
    etrWalk: s.etrLines.map((l) => ({
      description: l.description,
      amount: l.amount,
      taxImpact: l.taxImpact,
      rateImpactPercent: l.rateImpact,
      narrative: `Scripted narrative for ${l.description}.`,
    })),
    technicalMemos: s.temporaryDifferences.length > 0
      ? [{
          title: 'Timing difference memo',
          ircSection: 'Sec 174',
          bookTreatment: 'temporary',
          taxTreatment: 'capitalized',
          amount: s.temporaryDifferences[0].difference,
          taxImpact: s.temporaryDifferences[0].difference * 0.21,
          citation: 'IRC Sec 174',
          narrative: 'Scripted technical memo (harness mocked mode).',
          riskLevel: 'low' as const,
        }]
      : [],
    riskFlags: s.permanentDifferences.length > 0
      ? [{
          severity: 'medium' as const,
          description: 'Permanent difference requires documentation',
          recommendation: 'Document the book-tax difference.',
        }]
      : [],
    qualityScore: 90,
  };
}

function mockCredit(fixture: HarnessFixture): { accountMatches: Array<{ accountId: string; accountName: string; balance: number; creditType: string; confidence: number | string; description: string }>; recommendations: string[] } {
  const confidenceKind = fixture._meta.harness?.mockCreditConfidence ?? 'numeric';
  const rdAccounts = fixture.trialBalance.filter((a) => /rd|research|lab|prototype|engineering/i.test(a.accountName));
  return {
    accountMatches: rdAccounts.map((a) => ({
      accountId: a.accountId,
      accountName: a.accountName,
      balance: a.balance,
      creditType: 'rd_credit',
      category: 'wages',
      confidence: confidenceKind === 'numeric' ? 0.9 : 'medium',
      description: 'scripted mock (harness mocked mode)',
    })),
    recommendations: ['Review R&D credit'],
  };
}

function runMockedFixture(fixture: HarnessFixture): FixtureResult {
  // mapping
  const mappingRun = newRun();
  assertMappingOutput(mappingRun, mockMapping(fixture));

  // audit
  const auditRun = newRun();
  assertAuditOutput(auditRun, mockAudit(fixture));

  // credit — through the REAL schema so the malformed case rejects like production
  const creditRun = newRun();
  const mock = mockCredit(fixture);
  const parsed = creditIdentificationSchema.safeParse(mock);
  if (!parsed.success) {
    creditRun.fallback = true;
    check(creditRun, false, `credit response rejected by schema (${parsed.error.issues[0]?.path.join('.') ?? 'unknown'}): ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  } else {
    const rdPresent = fixture.trialBalance.some((a) => /rd|research|lab|prototype|engineering/i.test(a.accountName));
    const qualifying = parsed.data.accountMatches.reduce((sum, m) => sum + Math.abs(m.balance), 0);
    check(creditRun, Number.isFinite(qualifying) && qualifying >= 0, 'qualifying expenditure must be finite and >= 0');
    if (rdPresent) {
      check(creditRun, qualifying > 0, 'fixture contains R&D-labeled accounts; qualifying expenditure must be > 0');
    }
  }

  return {
    fixtureId: fixture._fixtureId,
    mapping: finalize(mappingRun),
    audit: finalize(auditRun),
    credit: finalize(creditRun),
  };
}

// ── Real mode: live agents ──

function mappingAccounts(fixture: HarnessFixture) {
  return fixture.trialBalance.map((a) => ({
    id: a.accountId,
    accountNumber: a.accountNumber,
    name: a.accountName,
    type: a.accountType,
    detailType: a.detailType,
    netBalance: a.balance,
  }));
}

function creditInput(fixture: HarnessFixture) {
  return {
    tenantId: fixture.tenant.id,
    tenantName: fixture.tenant.name,
    period: fixture.period,
    fiscalYear: fixture.fiscalYear,
    trialBalance: fixture.trialBalance.map((a) => ({
      accountId: a.accountId,
      accountName: a.accountName,
      accountNumber: a.accountNumber,
      accountType: a.accountType,
      balance: a.balance,
    })),
  };
}

async function runRealFixture(fixture: HarnessFixture): Promise<FixtureResult> {
  // mapping-agent
  const mappingRun = newRun();
  try {
    const result = await runMappingAgent({
      tenantId: fixture.tenant.id,
      tenantName: fixture.tenant.name,
      accounts: mappingAccounts(fixture),
    });
    if (!result.success) {
      mappingRun.fallback = true;
      mappingRun.detail.push(`mapping agent failed: ${result.error ?? 'unknown error'}`);
    } else {
      assertMappingOutput(mappingRun, result.taxMappings as MappingEntry[]);
    }
  } catch (err) {
    mappingRun.fallback = true;
    mappingRun.detail.push(`mapping agent threw: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // audit-defense
  const auditRun = newRun();
  try {
    const memo = await draftAuditMemo(fixture.provisionSummary);
    if (memo.executiveSummary.includes('[Audit memo generation failed')) {
      auditRun.fallback = true;
      const errMatch = memo.executiveSummary.match(/Error: ([^\]]+)/);
      auditRun.detail.push(errMatch ? `audit memo self-fallback: ${errMatch[1].trim()}` : 'audit memo self-fallback triggered');
    }
    assertAuditOutput(auditRun, memo);
  } catch (err) {
    auditRun.fallback = true;
    auditRun.detail.push(`audit agent threw: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // credit-miner
  const creditRun = newRun();
  try {
    const result = await mineCredits(creditInput(fixture));
    if (!result.success) {
      creditRun.fallback = true;
      creditRun.detail.push(`credit miner failed: ${result.error ?? 'unknown error'}`);
    } else {
      assertCreditOutput(creditRun, result as CreditResultLike, fixture);
    }
  } catch (err) {
    creditRun.fallback = true;
    creditRun.detail.push(`credit miner threw: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  return {
    fixtureId: fixture._fixtureId,
    mapping: finalize(mappingRun),
    audit: finalize(auditRun),
    credit: finalize(creditRun),
  };
}

// ── Reporting ──

function emptyTotals(): AgentTotals {
  return { ok: 0, total: 0, fallbacks: 0, checks: 0, failures: 0 };
}

function printFixtureLine(idx: number, total: number, fixtureId: string, runs: AgentRun[]): void {
  const tags = runs.map((r) => (r.ok ? 'PASS' : 'FAIL')).join(' | ');
  console.log(`  [${idx}/${total}] ${fixtureId}  ${tags}`);
  for (const [label, r] of [['mapping-agent', runs[0]], ['audit-defense', runs[1]], ['credit-miner', runs[2]]] as const) {
    if (r.failures > 0 || r.fallback || !r.ok) {
      console.log(`    ${label}: ${r.ok ? 'PASS' : 'FAIL'} (${r.checks} checks, ${r.failures} failures, fallback: ${r.fallback ? 'yes' : 'no'})`);
      for (const d of r.detail.slice(0, 5)) {
        console.log(`      - ${d}`);
      }
    }
  }
}

function accumulate(totals: AgentTotals, run: AgentRun, allDetails: string[]): void {
  totals.total++;
  totals.checks += run.checks;
  totals.failures += run.failures;
  if (run.ok) totals.ok++;
  if (run.fallback) totals.fallbacks++;
  allDetails.push(...run.detail);
}

async function main(): Promise<void> {
  const started = Date.now();
  const mode = resolveMode();
  const threshold = fallbackThreshold();
  const limit = fixtureLimit();

  const allFixtures = loadFixtures();
  const fixtures = limit === Number.POSITIVE_INFINITY ? allFixtures : allFixtures.slice(0, limit);
  console.log(`\nAgent Harness - ${allFixtures.length} fixtures (mode: ${mode}${fixtures.length < allFixtures.length ? `, limited to ${fixtures.length}` : ''})\n`);

  if (mode === 'dry-run') {
    console.log('Dry-run: no AI provider required. Fixtures that real mode would run:');
    for (const f of allFixtures) {
      console.log(`  ${f._fixtureId}  [${f._meta.jurisdiction}/${f._meta.scenario}] ${f.tenant.name} - ${f._meta.description}`);
    }
    console.log('\nDry-run complete. Set AI_EVAL_MODE=mocked for scripted validation, or AI_EVAL_MODE=real with AI_API_KEY for live agents.');
    recordTrendLine({
      timestamp: new Date().toISOString(),
      mode,
      provider: '-',
      model: '-',
      fixtures: allFixtures.length,
      invocations: 0,
      fallbacks: 0,
      fallbackRate: 0,
      overall: 'PASS',
      durationMs: Date.now() - started,
      byAgent: { mapping: emptyTotals(), audit: emptyTotals(), credit: emptyTotals() },
    });
    printRecentRuns();
    console.log('\nOVERALL: PASS (dry-run)');
    process.exit(0);
  }

  const totals = {
    mapping: emptyTotals(),
    audit: emptyTotals(),
    credit: emptyTotals(),
  };
  const structuralFailures: string[] = [];
  const allDetails: string[] = [];

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const result = mode === 'mocked'
      ? runMockedFixture(fixture)
      : await runRealFixture(fixture);

    printFixtureLine(i + 1, fixtures.length, fixture._fixtureId, [result.mapping, result.audit, result.credit]);

    accumulate(totals.mapping, result.mapping, allDetails);
    accumulate(totals.audit, result.audit, allDetails);
    accumulate(totals.credit, result.credit, allDetails);

    if (!result.mapping.ok && !result.mapping.fallback) structuralFailures.push(`${fixture._fixtureId}/mapping`);
    if (!result.audit.ok && !result.audit.fallback) structuralFailures.push(`${fixture._fixtureId}/audit`);
    if (!result.credit.ok && !result.credit.fallback) structuralFailures.push(`${fixture._fixtureId}/credit`);
  }

  const byAgent = [
    ['mapping-agent', totals.mapping],
    ['audit-defense', totals.audit],
    ['credit-miner', totals.credit],
  ] as const;

  console.log('\nAgent harness totals:');
  for (const [label, t] of byAgent) {
    const rate = ((t.fallbacks / t.total) * 100).toFixed(1);
    console.log(`  ${label.padEnd(14)} ${t.ok}/${t.total} structural PASS, fallback rate ${rate}%`);
  }

  const invocations = totals.mapping.total + totals.audit.total + totals.credit.total;
  const fallbacks = totals.mapping.fallbacks + totals.audit.fallbacks + totals.credit.fallbacks;
  const fallbackRate = invocations > 0 ? fallbacks / invocations : 0;

  let provider = '-';
  let model = '-';
  if (mode === 'real') {
    const cfg = getAiModel();
    provider = cfg.provider;
    model = cfg.modelName;
  }

  // Provider outage (403/429/timeouts) is not an agent failure: mirror
  // run-ai-mapping-eval.ts, which exits 0 for CI when the API is unreachable.
  // The fallback-rate threshold still applies to agent-level failures.
  const providerLevelReasons = allDetails
    .filter((d) => /Model request failed|timed out|timeout|fetch failed|network|ECONN|API key|quota|429|403|502|503/i.test(d));
  const providerUnreachable = mode === 'real'
    && invocations > 0
    && fallbacks === invocations
    && providerLevelReasons.length >= Math.ceil(invocations * 0.9);

  const thresholdExceeded = mode === 'real' && fallbackRate > threshold && !providerUnreachable;
  const overall = structuralFailures.length > 0 && !providerUnreachable || thresholdExceeded ? 'FAIL' : 'PASS';

  recordTrendLine({
    timestamp: new Date().toISOString(),
    mode,
    provider,
    model,
    fixtures: fixtures.length,
    invocations,
    fallbacks,
    fallbackRate,
    overall,
    durationMs: Date.now() - started,
    note: providerUnreachable ? 'provider-unreachable' : undefined,
    byAgent: {
      mapping: totals.mapping,
      audit: totals.audit,
      credit: totals.credit,
    },
  });
  printRecentRuns();

  if (providerUnreachable) {
    console.log(
      `\nAI provider unreachable (${provider}/${model}): ${providerLevelReasons[0] ?? 'API error'}. ` +
      `Harness incomplete - ${fallbacks}/${invocations} agent calls fell back. Exiting with code 0 for CI (mirrors run-ai-mapping-eval.ts). ` +
      `Fix the provider key or run AI_EVAL_MODE=mocked for scripted validation.`,
    );
    process.exit(0);
  }
  if (structuralFailures.length > 0) {
    console.log(`\nOVERALL: FAIL (structural failures in ${structuralFailures.length} agent runs: ${structuralFailures.slice(0, 10).join(', ')}${structuralFailures.length > 10 ? ', ...' : ''})`);
    process.exit(1);
  }
  if (thresholdExceeded) {
    console.log(`\nOVERALL: FAIL (fallback rate ${(fallbackRate * 100).toFixed(1)}% > ${(threshold * 100).toFixed(1)}% threshold)`);
    process.exit(1);
  }
  if (mode === 'mocked') {
    console.log(`\nOVERALL: PASS (mocked mode; fallback rate ${(fallbackRate * 100).toFixed(1)}% — no threshold enforced outside real mode)`);
    process.exit(0);
  }
  console.log(`\nOVERALL: PASS (fallback rate ${(fallbackRate * 100).toFixed(1)}% <= ${(threshold * 100).toFixed(1)}% threshold)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Agent harness crashed:', err);
  process.exit(1);
});
