// ─────────────────────────────────────────────────────────────────────────────
// Phase D — Filing-handoff export package (deterministic ZIP).
//
// A controlled package for the accountant to take to filing:
//   * approved workpaper (Excel, same generator as the legacy package)
//   * calculation output, ETR reconciliation, deferred-tax schedule
//   * CT600 figures (JSON + CSV, band-correct) and validation results
//   * iXBRL accounts document when it validates clean (self-excluded with a
//     reason when it does not — never shipped invalid)
//   * audit trail, evidence index, review decisions, assumptions,
//     approval trail, README and the evidence manifest
//
// Deterministic: fixed entry order, fixed ZIP entry timestamps, no
// wall-clock time anywhere in content (generatedAt comes from locked-run
// data). Self-exclusion rules document what is deliberately NOT in the
// package (secrets, tokens, AI traces, source-document contents — hashes
// only).
// ─────────────────────────────────────────────────────────────────────────────

import { ZipArchive } from 'archiver';
import { Readable } from 'stream';
import { generateProvisionWorkbook } from '../export/excel-generator.js';
import { buildAuditCsv } from '../export/package-export.js';
import type { AuditTrailEntry } from '../export/audit-log.js';
import type { Ct600Return } from '../export/ct600.js';
import { ct600ToCsv } from '../export/ct600.js';
import { buildHandoffManifest, sha256Hex, type HandoffManifest, type HandoffManifestInput } from './manifest.js';

export interface HandoffPackageInput {
  period: string;
  bookIncome: number;
  currentTaxExpense: number;
  deferredTaxExpense: number;
  totalTaxExpense: number;
  effectiveTaxRate: number;
  statutoryRate: number;
  taxPayable: number;
  createdAt: string;
  auditEntries: AuditTrailEntry[];
  detail: Record<string, unknown> | null;
  ct600: Ct600Return | null;
  ct600Validation: HandoffManifestInput['validation'];
  ixbrl: { filename: string; content: string; validation: IxbrlValidationLike } | null;
  evidenceIndex: Array<{ id: string; filename: string; documentType: string; sha256: string; version: number }>;
  assumptions: unknown;
  reviewDecisions: HandoffManifestInput['reviewDecisions'];
  approvals: HandoffManifestInput['approvals'];
  manifestInput: Omit<HandoffManifestInput, 'exports' | 'selfExclusionRules'>;
}

interface IxbrlValidationLike {
  valid: boolean;
  checksRun: number;
  violations: string[];
}

export interface HandoffPackageResult {
  zip: Buffer;
  manifestSha256: string;
  manifest: HandoffManifest;
  files: Array<{ name: string; sha256: string; bytes: number }>;
}

interface PackageFile {
  name: string;
  content: Buffer;
}

export async function buildHandoffPackage(input: HandoffPackageInput): Promise<HandoffPackageResult> {
  const p = input.period;
  const files: PackageFile[] = [];

  // 1. Approved workpaper (Excel) — same generator as the legacy package.
  const xlsxBuf = await generateProvisionWorkbook({
    period: p,
    bookIncome: input.bookIncome,
    currentTaxExpense: input.currentTaxExpense,
    deferredTaxExpense: input.deferredTaxExpense,
    totalTaxExpense: input.totalTaxExpense,
    effectiveTaxRate: input.effectiveTaxRate,
    statutoryRate: input.statutoryRate,
    taxPayable: input.taxPayable,
    valuationAllowance: 0,
    createdAt: input.createdAt,
  });
  files.push({ name: `workpapers/provision-${p}.xlsx`, content: xlsxBuf });

  // 2. Calculation output (deterministic stored detail).
  const calcOutput = input.detail ?? {};
  files.push({ name: `calculations/calc-output-${p}.json`, content: Buffer.from(JSON.stringify(calcOutput, null, 2), 'utf-8') });

  // 3. ETR reconciliation (derived, deterministic).
  const etr = buildEtrReconciliation(input);
  files.push({ name: `calculations/etr-reconciliation-${p}.json`, content: Buffer.from(JSON.stringify(etr, null, 2), 'utf-8') });

  // 4. Deferred tax schedule (from stored temporary differences).
  const deferred = buildDeferredSchedule(input.detail);
  files.push({ name: `calculations/deferred-tax-schedule-${p}.json`, content: Buffer.from(JSON.stringify(deferred, null, 2), 'utf-8') });

  // 5. CT600 figures + validation.
  if (input.ct600) {
    files.push({ name: `returns/ct600-${p}.json`, content: Buffer.from(JSON.stringify(input.ct600, null, 2), 'utf-8') });
    files.push({ name: `returns/ct600-${p}.csv`, content: Buffer.from(ct600ToCsv(input.ct600), 'utf-8') });
  }

  // 6. iXBRL accounts document (only when it validates clean).
  const ixbrlIncluded = !!(input.ixbrl && input.ixbrl.validation.valid);
  if (ixbrlIncluded && input.ixbrl) {
    files.push({ name: `returns/${input.ixbrl.filename}`, content: Buffer.from(input.ixbrl.content, 'utf-8') });
  }

  // 7. Validation results.
  files.push({
    name: `returns/validation-results-${p}.json`,
    content: Buffer.from(JSON.stringify({
      ct600: input.ct600Validation.ct600,
      ixbrl: input.ixbrl
        ? { included: ixbrlIncluded, valid: input.ixbrl.validation.valid, checksRun: input.ixbrl.validation.checksRun, violations: input.ixbrl.validation.violations }
        : null,
      note: 'Validation is structural conformance of TaxPro-generated figures. Filing readiness additionally requires HMRC gateway / agent software validation outside TaxPro.',
    }, null, 2), 'utf-8'),
  });

  // 8. Audit trail.
  files.push({ name: `audit/audit-trail-${p}.csv`, content: Buffer.from(buildAuditCsv(input.auditEntries), 'utf-8') });

  // 9. Evidence index (hashes only — never file contents).
  files.push({ name: `audit/evidence-index-${p}.json`, content: Buffer.from(JSON.stringify(input.evidenceIndex, null, 2), 'utf-8') });

  // 10. Assumptions + review decisions + approval trail.
  files.push({ name: `audit/assumptions-${p}.json`, content: Buffer.from(JSON.stringify(input.assumptions ?? {}, null, 2), 'utf-8') });
  files.push({ name: `audit/review-decisions-${p}.json`, content: Buffer.from(JSON.stringify(input.reviewDecisions, null, 2), 'utf-8') });
  files.push({ name: `audit/approval-trail-${p}.json`, content: Buffer.from(JSON.stringify(input.approvals, null, 2), 'utf-8') });

  // 11. README (honesty notice).
  files.push({ name: `README-${p}.txt`, content: Buffer.from(buildReadme(input, ixbrlIncluded), 'utf-8') });

  // 12. Manifest — hashes every content file EXCEPT itself and the .sha256
  //     carrier (self-hashing is impossible). The manifest's own integrity is
  //     the package-level sha256 returned to the caller and required when
  //     recording the external filing.
  const exportEntries = files.map((f) => ({ name: f.name, sha256: sha256Hex(f.content), bytes: f.content.length }));
  const { manifest, sha256 } = buildHandoffManifest({
    ...input.manifestInput,
    exports: exportEntries,
    selfExclusionRules: buildSelfExclusionRules(input, ixbrlIncluded),
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');
  files.push({ name: `manifest-${p}.json`, content: manifestBytes });
  files.push({ name: `manifest-${p}.sha256`, content: Buffer.from(`${sha256}  manifest-${p}.json\n`, 'utf-8') });

  // Deterministic zip: fixed entry dates so a locked run reproduces
  // byte-identical bytes.
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  for (const f of files) {
    archive.append(Readable.from([f.content]), { name: f.name, date: new Date(0) } as { name: string; date?: Date });
  }
  await archive.finalize();

  return {
    zip: Buffer.concat(chunks),
    manifestSha256: sha256,
    manifest,
    files: exportEntries,
  };
}

function buildEtrReconciliation(input: HandoffPackageInput): Record<string, unknown> {
  const ct = (input.detail?.currentTax ?? {}) as Record<string, unknown>;
  const lineItems = (input.detail?.lineItems ?? {}) as { permanentDifferences?: Array<{ label: string; amount: unknown }> };
  return {
    period: input.period,
    bookIncome: input.bookIncome,
    currentTaxExpense: input.currentTaxExpense,
    deferredTaxExpense: input.deferredTaxExpense,
    totalTaxExpense: input.totalTaxExpense,
    effectiveTaxRate: input.effectiveTaxRate,
    statutoryRate: input.statutoryRate,
    rateVariance: input.bookIncome !== 0 ? round4(input.effectiveTaxRate - input.statutoryRate) : 0,
    permanentDifferences: lineItems.permanentDifferences ?? [],
    marginalRelief: Number(ct.marginalRelief ?? 0),
    basis: 'Statutory rate is the UK corporation tax main rate per the tenant rules; effective rate is total tax expense over book income (FRS 102).',
  };
}

function buildDeferredSchedule(detail: Record<string, unknown> | null): Record<string, unknown> {
  const ct = (detail?.currentTax ?? {}) as Record<string, unknown>;
  const lineItems = (detail?.lineItems ?? {}) as { temporaryDifferences?: Array<{ accountId: string; label: string; difference: unknown; timingCategory: string }> };
  return {
    deferredTaxExpense: Number(ct.deferredTaxExpense ?? 0),
    valuationAllowance: 0,
    timingDifferences: lineItems.temporaryDifferences ?? [],
    basis: 'Deferred tax under FRS 102 Section 29; full recovery assumed; no discounting.',
  };
}

function buildSelfExclusionRules(input: HandoffPackageInput, ixbrlIncluded: boolean): Array<{ path: string; reason: string }> {
  const rules = [
    { path: 'secrets/tokens', reason: 'No credentials, API keys, tokens or passwords are ever included in the package.' },
    { path: 'ai-traces.csv', reason: 'Internal AI subagent traces are excluded from the filing package — they may contain source-document excerpts and are not filing artefacts.' },
    { path: 'source-document-contents', reason: 'Source documents are never shipped; only their SHA-256 hashes appear in the evidence index and manifest.' },
    { path: 'personal-data', reason: 'No personal data beyond company identifiers required for the filing (company name, UTR, Companies House number).' },
    { path: 'cross-tenant-data', reason: 'The package is built exclusively from the owning tenant\u2019s rows; RLS isolation is enforced at query time.' },
    { path: `returns/${input.ixbrl ? input.ixbrl.filename : 'ixbrl-*.xml'}`, reason: ixbrlIncluded ? 'Included because it validated clean.' : 'Excluded because the generated iXBRL document did not validate clean; it is never shipped invalid.' },
  ];
  return rules;
}

function buildReadme(input: HandoffPackageInput, ixbrlIncluded: boolean): string {
  const ct = input.ct600;
  const band = ct ? 'ct600 figures included (band-correct)' : 'no CT600 figures';
  return [
    `TaxPro UK Filing Package — Period ${input.period}`,
    `Generated from locked run data: ${input.approvals.lockedAt ?? input.approvals.approvedAt ?? 'n/a'}`,
    '',
    'CONTENTS',
    `  workpapers/provision-${input.period}.xlsx          Approved workpaper (summary, current/deferred tax, ETR, line items)`,
    `  calculations/calc-output-${input.period}.json      Deterministic calculation output`,
    `  calculations/etr-reconciliation-${input.period}.json  ETR bridge vs statutory rate`,
    `  calculations/deferred-tax-schedule-${input.period}.json  Deferred tax under FRS 102 Section 29`,
    `  returns/ct600-${input.period}.json / .csv          ${band}`,
    input.ixbrl && ixbrlIncluded ? `  returns/${input.ixbrl.filename}                              iXBRL accounts document (validated clean)` : '  returns/ixbrl-*.xml                               NOT included (did not validate clean)',
    `  returns/validation-results-${input.period}.json    Structural validation results`,
    `  audit/audit-trail-${input.period}.csv              Immutable audit trail`,
    `  audit/evidence-index-${input.period}.json          Source-document hashes (no contents)`,
    `  audit/assumptions-${input.period}.json             Assumptions applied`,
    `  audit/review-decisions-${input.period}.json        Review decisions`,
    `  audit/approval-trail-${input.period}.json          Approval / lock / handoff trail`,
    `  manifest-${input.period}.json                      Evidence manifest (all file hashes)`,
    `  manifest-${input.period}.sha256                    SHA-256 of the manifest`,
    '',
    'HONESTY NOTICE',
    '- TaxPro does NOT submit anything to HMRC. This package is evidence for',
    '  the accountant to file through agent software / the HMRC gateway.',
    '- CT600/iXBRL artefacts are structural and figure-level only; they must',
    '  pass HMRC gateway validation before submission.',
    '- Manifest hashes are verifiable against the manifest.sha256 file and',
    '  the recorded external filing record.',
    '- No secrets, tokens or source-document contents are included.',
    '',
  ].join('\n');
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
