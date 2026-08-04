// ─────────────────────────────────────────────────────────────────────────────
// Phase D — pure gate + artefact tests (no DB).
// Covers: handoff/filing/maker-checker gates, lifecycle derivation,
// band-correct CT600, deterministic manifest + package bytes.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  evaluateHandoffGates,
  evaluateFilingGate,
  violatesMakerChecker,
  deriveLifecycleStage,
} from '../modules/handoff/gates.js';
import { buildHandoffCt600, bandSummary } from '../modules/handoff/ct600.js';
import { validateCt600Return } from '../modules/export/ct600-validation.js';
import { buildHandoffManifest, MANIFEST_SCHEMA_VERSION } from '../modules/handoff/manifest.js';
import { buildHandoffPackage } from '../modules/handoff/package.js';

const COMPANY = { companyName: 'Acme UK Ltd', utr: '8596148860', companiesHouseNumber: '12345678' };
const PERIOD = { start: '2026-01-01', end: '2026-12-31' };

const okCtx = {
  runLocked: true,
  evidencePresent: true,
  openReviewItemCount: 0,
  pendingMappingProposalCount: 0,
  ct600ValidationValid: true,
  ixbrlValidationValid: null,
  handoffAlreadyMarked: false,
};

describe('Phase D — handoff gates (pure)', () => {
  it('passes when locked, evidenced, resolved and valid', () => {
    expect(evaluateHandoffGates(okCtx).blocked).toBe(false);
  });

  it('blocks an unlocked run', () => {
    const res = evaluateHandoffGates({ ...okCtx, runLocked: false });
    expect(res.blocked).toBe(true);
    expect(res.blockers.map((b) => b.code)).toContain('run_not_locked');
  });

  it('blocks on missing evidence', () => {
    const res = evaluateHandoffGates({ ...okCtx, evidencePresent: false });
    expect(res.blockers.map((b) => b.code)).toContain('evidence_required');
  });

  it('blocks on open review items, pending mappings and validation errors', () => {
    const res = evaluateHandoffGates({
      ...okCtx,
      openReviewItemCount: 2,
      pendingMappingProposalCount: 1,
      ct600ValidationValid: false,
      ixbrlValidationValid: false,
    });
    const codes = res.blockers.map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['open_review_items', 'mapping_proposals_pending', 'ct600_validation_errors', 'ixbrl_validation_errors']));
  });

  it('blocks re-marking an already handed-off run', () => {
    const res = evaluateHandoffGates({ ...okCtx, handoffAlreadyMarked: true });
    expect(res.blockers.map((b) => b.code)).toContain('already_handed_off');
  });

  it('filing gate requires locked + filing-ready', () => {
    expect(evaluateFilingGate({ runLocked: false, handoffReady: true }).blockers.map((b) => b.code)).toContain('run_not_locked');
    expect(evaluateFilingGate({ runLocked: true, handoffReady: false }).blockers.map((b) => b.code)).toContain('handoff_not_ready');
    expect(evaluateFilingGate({ runLocked: true, handoffReady: true }).blocked).toBe(false);
  });

  it('maker-checker only bites when enabled and actor is the run creator', () => {
    expect(violatesMakerChecker(false, 'u1', 'u1')).toBe(false);
    expect(violatesMakerChecker(true, 'u1', 'u1')).toBe(true);
    expect(violatesMakerChecker(true, 'u1', 'u2')).toBe(false);
    expect(violatesMakerChecker(true, null, 'u1')).toBe(false);
  });
});

describe('Phase D — lifecycle derivation (pure)', () => {
  it('walks the honest stage ladder', () => {
    const base = { status: 'draft', approvalStatus: 'not_required', handoffReady: false, filedExternally: false, sourceDocumentLinked: true, openItemTypes: [] };
    expect(deriveLifecycleStage(base).stage).toBe('draft');
    expect(deriveLifecycleStage({ ...base, status: 'calculated' }).stage).toBe('calculated');
    expect(deriveLifecycleStage({ ...base, status: 'needs_review', openItemTypes: ['missing_mapping'] }).stage).toBe('needs_mapping_review');
    expect(deriveLifecycleStage({ ...base, status: 'needs_review', sourceDocumentLinked: false }).stage).toBe('needs_evidence');
    expect(deriveLifecycleStage({ ...base, status: 'needs_review', openItemTypes: ['low_confidence_mapping'] }).stage).toBe('needs_tax_review');
    expect(deriveLifecycleStage({ ...base, status: 'calculated', approvalStatus: 'approved' }).stage).toBe('approved');
    expect(deriveLifecycleStage({ ...base, status: 'locked' }).stage).toBe('locked');
    expect(deriveLifecycleStage({ ...base, status: 'locked', handoffReady: true }).stage).toBe('filing_ready');
    expect(deriveLifecycleStage({ ...base, status: 'locked', handoffReady: true, filedExternally: true }).stage).toBe('filed_externally');
  });
});

describe('Phase D — band-correct CT600 (pure)', () => {
  const gen = '2026-06-01T10:00:00.000Z';

  it('small profits band: charge in Box 13, Box 12 zero, validates clean', () => {
    const detail = { currentTax: { taxableIncome: 2690, federalTax: 511.1, marginalRelief: 0, taxCredits: 0, estimatedPayments: 0 } };
    const ct = buildHandoffCt600(COMPANY, PERIOD, detail, gen);
    const box = (n: number) => Number(ct.boxes.find((b) => b.box === n)?.value ?? 0);
    expect(box(12)).toBe(0);
    expect(box(13)).toBeGreaterThan(0);
    expect(box(14)).toBe(0);
    expect(bandSummary(detail).band).toBe('small_profits');
    expect(validateCt600Return(ct).valid).toBe(true);
  });

  it('marginal relief band: gross main rate in Box 12, relief in Box 14, validates clean', () => {
    const detail = { currentTax: { taxableIncome: 125000, federalTax: 29375, marginalRelief: 1875, taxCredits: 0, estimatedPayments: 0 } };
    const ct = buildHandoffCt600(COMPANY, PERIOD, detail, gen);
    const box = (n: number) => Number(ct.boxes.find((b) => b.box === n)?.value ?? 0);
    expect(box(12)).toBe(31250); // 125000 × 25%
    expect(box(14)).toBe(1875);  // 3/200 × (250k − 125k)
    expect(box(13)).toBe(0);
    expect(bandSummary(detail).band).toBe('marginal_relief');
    const v = validateCt600Return(ct);
    expect(v.violations.map((x) => x.ruleId)).not.toContain('MARGINAL_RELIEF_ALIGNMENT');
    expect(v.valid).toBe(true);
  });

  it('main rate band: whole charge in Box 12, validates clean', () => {
    const detail = { currentTax: { taxableIncome: 400000, federalTax: 100000, marginalRelief: 0, taxCredits: 0, estimatedPayments: 0 } };
    const ct = buildHandoffCt600(COMPANY, PERIOD, detail, gen);
    const box = (n: number) => Number(ct.boxes.find((b) => b.box === n)?.value ?? 0);
    expect(box(12)).toBe(100000);
    expect(box(13)).toBe(0);
    expect(bandSummary(detail).band).toBe('main_rate');
    expect(validateCt600Return(ct).valid).toBe(true);
  });

  it('is deterministic: identical inputs produce identical output regardless of wall clock', () => {
    const detail = { currentTax: { taxableIncome: 2690, federalTax: 511.1, marginalRelief: 0, taxCredits: 0, estimatedPayments: 0 } };
    const a = JSON.stringify(buildHandoffCt600(COMPANY, PERIOD, detail, gen));
    const b = JSON.stringify(buildHandoffCt600(COMPANY, PERIOD, detail, gen));
    expect(a).toBe(b);
    expect(b).toContain('"generatedAt":"2026-06-01T10:00:00.000Z"');
  });
});

describe('Phase D — evidence manifest (pure)', () => {
  const baseManifestInput = {
    tenantId: 't1',
    entity: { id: 'e1', name: 'Acme UK Ltd', taxJurisdiction: 'UK_FRS102', currency: 'GBP', externalId: '8596148860' },
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    run: {
      id: 'r1', engineVersion: 'tax-engine-0.1.0', rulesUsed: { 'uk.rates.v1': { version: 1 } },
      inputDataHash: 'abc', mappingVersionHash: 'def', parentRunId: null, correlationId: 'c1',
      idempotencyKey: null, status: 'locked', approvalStatus: 'approved', sourceDocumentId: 'd1',
    },
    evidence: { id: 'd1', filename: 'tb-fy2026.csv', sha256: 'aaa', version: 1 },
    assumptions: ['UK corporation tax main rate 25%'],
    warnings: [],
    approvals: {
      approvalStatus: 'approved', submittedAt: '2026-05-01T09:00:00.000Z', submittedByUserId: 'u1',
      approvedAt: '2026-05-02T09:00:00.000Z', approvedByUserId: 'u2', lockedAt: '2026-05-03T09:00:00.000Z',
      lockedByUserId: 'u2', handoffReadyAt: null, handoffReadyByUserId: null, filedExternallyAt: null, filedExternallyByUserId: null,
    },
    reviewDecisions: [{ id: 'i1', itemType: 'missing_mapping', title: 'Map Sundry', severity: 'high', status: 'resolved', resolutionNote: 'Confirmed other income', resolvedAt: '2026-05-01T12:00:00.000Z', resolvedByUserId: 'u2' }],
    validation: { ct600: { valid: true, rulesRun: 12, violations: [], skipped: [] }, ixbrl: null },
    ct600: null,
    exports: [{ name: 'workpapers/provision-2026-01-01.xlsx', sha256: 'x1', bytes: 100 }],
    selfExclusionRules: [{ path: 'secrets/tokens', reason: 'never included' }],
  };

  it('is deterministic and self-hashes', () => {
    const a = buildHandoffManifest(baseManifestInput);
    const b = buildHandoffManifest(baseManifestInput);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(a.manifest.generatedAt).toBe('2026-05-03T09:00:00.000Z'); // from immutable lockedAt
    expect(a.manifest.exports[0].sha256).toBe('x1');
    expect(a.manifest.kind).toBe('uk-filing-handoff-manifest');
  });

  it('changes when run data changes (never silently)', () => {
    const altered = buildHandoffManifest({ ...baseManifestInput, run: { ...baseManifestInput.run, inputDataHash: 'CHANGED' } });
    expect(altered.sha256).not.toBe(buildHandoffManifest(baseManifestInput).sha256);
  });
});

describe('Phase D — export package (pure)', () => {
  const pkgInput = {
    period: '2026-01-01',
    bookIncome: 4000,
    currentTaxExpense: 511.1,
    deferredTaxExpense: 0,
    totalTaxExpense: 511.1,
    effectiveTaxRate: 0.127775,
    statutoryRate: 0.25,
    taxPayable: 511.1,
    createdAt: '2026-05-01T09:00:00.000Z',
    auditEntries: [
      { timestamp: '2026-05-01T09:00:00.000Z', eventType: 'run.created', actor: 'user-1', description: 'Run created', metadata: { mode: 'direct' } },
    ],
    detail: {
      currentTax: { taxableIncome: 2690, federalTax: 511.1, marginalRelief: 0, taxCredits: 0, estimatedPayments: 0 },
      summary: { totalTaxExpense: 511.1 },
      lineItems: { permanentDifferences: [{ label: 'Non-deductible', amount: 100 }], temporaryDifferences: [] },
    },
    ct600: buildHandoffCt600(COMPANY, PERIOD, { currentTax: { taxableIncome: 2690, federalTax: 511.1, marginalRelief: 0, taxCredits: 0, estimatedPayments: 0 } }, '2026-05-03T09:00:00.000Z'),
    ct600Validation: {
      ct600: { valid: true, rulesRun: 12, violations: [], skipped: [] },
      ixbrl: null,
    },
    ixbrl: null,
    evidenceIndex: [{ id: 'd1', filename: 'tb-fy2026.csv', documentType: 'trial_balance', sha256: 'aaa', version: 1 }],
    assumptions: ['UK corporation tax main rate 25% applied per fiscal year.'],
    reviewDecisions: [],
    approvals: {
      approvalStatus: 'approved', submittedAt: '2026-05-01T09:00:00.000Z', submittedByUserId: 'u1',
      approvedAt: '2026-05-02T09:00:00.000Z', approvedByUserId: 'u2', lockedAt: '2026-05-03T09:00:00.000Z',
      lockedByUserId: 'u2', handoffReadyAt: null, handoffReadyByUserId: null, filedExternallyAt: null, filedExternallyByUserId: null,
    },
    manifestInput: {
      tenantId: 't1',
      entity: { id: 'e1', name: 'Acme UK Ltd', taxJurisdiction: 'UK_FRS102', currency: 'GBP', externalId: '8596148860' },
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      run: {
        id: 'r1', engineVersion: 'tax-engine-0.1.0', rulesUsed: { 'uk.rates.v1': { version: 1 } },
        inputDataHash: 'abc', mappingVersionHash: 'def', parentRunId: null, correlationId: 'c1',
        idempotencyKey: null, status: 'locked', approvalStatus: 'approved', sourceDocumentId: 'd1',
      },
      evidence: { id: 'd1', filename: 'tb-fy2026.csv', sha256: 'aaa', version: 1 },
      assumptions: ['UK corporation tax main rate 25% applied per fiscal year.'],
      warnings: [],
      approvals: {
        approvalStatus: 'approved', submittedAt: '2026-05-01T09:00:00.000Z', submittedByUserId: 'u1',
        approvedAt: '2026-05-02T09:00:00.000Z', approvedByUserId: 'u2', lockedAt: '2026-05-03T09:00:00.000Z',
        lockedByUserId: 'u2', handoffReadyAt: null, handoffReadyByUserId: null, filedExternallyAt: null, filedExternallyByUserId: null,
      },
      reviewDecisions: [],
      validation: { ct600: { valid: true, rulesRun: 12, violations: [], skipped: [] }, ixbrl: null },
      ct600: null,
    },
  };

  it('produces byte-identical ZIPs across wall-clock gaps and verifiable manifest hashes', async () => {
    const a = await buildHandoffPackage(pkgInput as any);
    const b = await buildHandoffPackage(pkgInput as any);
    expect(a.zip.equals(b.zip)).toBe(true);
    expect(a.manifestSha256).toBe(b.manifestSha256);

    // The manifest self-hash verifies against the manifest bytes inside the ZIP.
    const zip = a.zip;
    const { default: jszip } = await import('jszip');
    const archive = await jszip.loadAsync(zip);
    const manifestName = Object.keys(archive.files).find((n) => /manifest-2026-01-01\.json$/.test(n));
    expect(manifestName).toBeDefined();
    const manifestBytes = await archive.files[manifestName!].async('nodebuffer');
    expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(a.manifestSha256);
  });

  it('contains the expected controlled set and no banned entries', async () => {
    const { zip } = await buildHandoffPackage(pkgInput as any);
    const { default: jszip } = await import('jszip');
    const archive = await jszip.loadAsync(zip);
    const names = Object.keys(archive.files);
    for (const expected of [
      'workpapers/provision-2026-01-01.xlsx',
      'calculations/calc-output-2026-01-01.json',
      'calculations/etr-reconciliation-2026-01-01.json',
      'calculations/deferred-tax-schedule-2026-01-01.json',
      'returns/ct600-2026-01-01.json',
      'returns/ct600-2026-01-01.csv',
      'returns/validation-results-2026-01-01.json',
      'audit/audit-trail-2026-01-01.csv',
      'audit/evidence-index-2026-01-01.json',
      'audit/assumptions-2026-01-01.json',
      'audit/review-decisions-2026-01-01.json',
      'audit/approval-trail-2026-01-01.json',
      'README-2026-01-01.txt',
      'manifest-2026-01-01.json',
      'manifest-2026-01-01.sha256',
    ]) {
      expect(names).toContain(expected);
    }
    expect(names.some((n) => n.includes('ai-traces'))).toBe(false); // self-excluded
    expect(names.some((n) => /ixbrl/.test(n))).toBe(false);         // not generated → absent
    const readme = await archive.files['README-2026-01-01.txt'].async('string');
    expect(readme).toMatch(/TaxPro does NOT submit anything to HMRC/i);
    expect(readme).toMatch(/no secrets/i);
  });
});
