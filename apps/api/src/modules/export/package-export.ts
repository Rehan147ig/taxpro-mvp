import { ZipArchive } from 'archiver';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { generateProvisionWorkbook } from './excel-generator.js';
import type { AuditTrailEntry } from './audit-log.js';

export interface PackageReviewItem {
  itemType: string;
  title: string;
  severity: string;
  status: string;
  confidenceScore: number | null;
}

export interface PackageAiTrace {
  workflowName: string;
  status: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  errorMessage: string | null;
  completedAt: string | null;
}

export interface PackageApprovalTrail {
  approvalStatus: string;
  submittedAt: string | null;
  finalizedAt: string | null;
}

export interface WorkpaperPackageInput {
  period: string;
  bookIncome: number;
  currentTaxExpense: number;
  deferredTaxExpense: number;
  totalTaxExpense: number;
  effectiveTaxRate: number;
  statutoryRate: number;
  taxPayable: number;
  valuationAllowance: number;
  createdAt: string;
  auditEntries: AuditTrailEntry[];
  reviewItems?: PackageReviewItem[];
  aiTraces?: PackageAiTrace[];
  approvalTrail?: PackageApprovalTrail;
  sourceHash?: string | null;
  assumptions?: Record<string, unknown>;
}

interface PackageFile {
  name: string;
  content: Buffer;
}

export async function generateWorkpaperPackage(input: WorkpaperPackageInput): Promise<Buffer> {
  const files: PackageFile[] = [];

  // 1. Excel workpaper
  const xlsxBuf = await generateProvisionWorkbook({
    period: input.period,
    bookIncome: input.bookIncome,
    currentTaxExpense: input.currentTaxExpense,
    deferredTaxExpense: input.deferredTaxExpense,
    totalTaxExpense: input.totalTaxExpense,
    effectiveTaxRate: input.effectiveTaxRate,
    statutoryRate: input.statutoryRate,
    taxPayable: input.taxPayable,
    valuationAllowance: input.valuationAllowance,
    createdAt: input.createdAt,
  });
  files.push({ name: `provision-${input.period}.xlsx`, content: xlsxBuf });

  // 2. Audit trail CSV
  files.push({ name: `audit-trail-${input.period}.csv`, content: Buffer.from(buildAuditCsv(input.auditEntries), 'utf-8') });

  // 3. Review items CSV
  files.push({ name: 'review-items.csv', content: Buffer.from(buildReviewItemsCsv(input.reviewItems ?? []), 'utf-8') });

  // 4. AI traces CSV
  files.push({ name: 'ai-traces.csv', content: Buffer.from(buildAiTracesCsv(input.aiTraces ?? []), 'utf-8') });

  // 5. Approval trail JSON
  files.push({ name: 'approval-trail.json', content: Buffer.from(JSON.stringify({
    period: input.period,
    ...(input.approvalTrail ?? { approvalStatus: 'unknown', submittedAt: null, finalizedAt: null }),
    sourceHash: input.sourceHash ?? null,
  }, null, 2), 'utf-8') });

  // 6. Assumptions JSON
  files.push({ name: 'assumptions.json', content: Buffer.from(JSON.stringify({
    statutoryRate: input.statutoryRate,
    valuationAllowance: input.valuationAllowance,
    missingDepreciationMetadataItems: (input.reviewItems ?? []).filter(i => i.itemType === 'missing_depreciation_metadata').length,
    ...(input.assumptions ?? {}),
  }, null, 2), 'utf-8') });

  // 7. Manifest with per-file SHA-256 (reproducibility + integrity)
  files.push({ name: 'manifest.json', content: Buffer.from(buildPackageManifest(input.createdAt, input.sourceHash, files), 'utf-8') });

  // 8. Summary text
  files.push({ name: 'package-summary.txt', content: Buffer.from(buildSummaryText(input, files.length), 'utf-8') });

  // Deterministic zip: fixed entry dates so a locked run reproduces byte-identical bytes.
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  for (const f of files) {
    archive.append(Readable.from([f.content]), { name: f.name, date: new Date(0) } as { name: string; date?: Date });
  }
  await archive.finalize();
  return Buffer.concat(chunks);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function buildPackageManifest(createdAt: string, sourceHash: string | null | undefined, files: PackageFile[]): string {
  return JSON.stringify({
    generatedAt: createdAt,
    sourceHash: sourceHash ?? null,
    files: files.map(f => ({ name: f.name, sha256: sha256(f.content) })),
  }, null, 2);
}

export function buildAuditCsv(entries: AuditTrailEntry[]): string {
  const headers = ['timestamp', 'event_type', 'actor', 'description', 'details'];
  const rows = entries.map((e) => [
    e.timestamp,
    e.eventType,
    e.actor ?? 'system',
    e.description,
    JSON.stringify(e.metadata ?? {}),
  ].map(escapeCsv).join(','));

  return [headers.join(','), ...rows].join('\n');
}

export function buildReviewItemsCsv(items: PackageReviewItem[]): string {
  const headers = ['item_type', 'title', 'severity', 'status', 'confidence_score'];
  const rows = items.map((i) => [i.itemType, i.title, i.severity, i.status, String(i.confidenceScore ?? '')]);
  return [headers.join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
}

export function buildAiTracesCsv(traces: PackageAiTrace[]): string {
  const headers = ['workflow_name', 'status', 'provider', 'model', 'prompt_version', 'error_message', 'completed_at'];
  const rows = traces.map((t) => [t.workflowName, t.status, t.provider ?? '', t.model ?? '', t.promptVersion, t.errorMessage ?? '', t.completedAt ?? '']);
  return [headers.join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
}

export function buildSummaryText(input: WorkpaperPackageInput, fileCount: number): string {
  const reviewItemCount = input.reviewItems?.length ?? 0;
  const aiTraceCount = input.aiTraces?.length ?? 0;
  return [
    `TaxPro Provision Package - Period: ${input.period}`,
    `Generated: ${input.createdAt}`,
    '',
    `Book Income:      ${input.bookIncome.toLocaleString()}`,
    `Current Tax:      ${input.currentTaxExpense.toLocaleString()}`,
    `Deferred Tax:     ${input.deferredTaxExpense.toLocaleString()}`,
    `Total Tax:        ${input.totalTaxExpense.toLocaleString()}`,
    `Effective Rate:   ${(input.effectiveTaxRate * 100).toFixed(2)}%`,
    `Statutory Rate:   ${(input.statutoryRate * 100).toFixed(2)}%`,
    `Tax Payable:      ${input.taxPayable.toLocaleString()}`,
    `Audit Entries:    ${input.auditEntries.length}`,
    `Review Items:     ${reviewItemCount}`,
    `AI Traces:        ${aiTraceCount}`,
    `Source Hash:      ${input.sourceHash ?? 'n/a'}`,
    '',
    '--- Files ---',
    `provision-${input.period}.xlsx    - 4-tab Excel workpaper`,
    `audit-trail-${input.period}.csv   - Full audit trail`,
    'review-items.csv                  - Review queue snapshot',
    'ai-traces.csv                     - AI subagent traces',
    'approval-trail.json               - Approval/submission/finalization trail',
    'assumptions.json                  - Assumptions applied',
    'manifest.json                     - Per-file SHA-256 (reproducibility)',
    'package-summary.txt               - This file',
    '',
    `(${fileCount} files; deterministic build for locked runs)`,
    '',
  ].join('\n');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
