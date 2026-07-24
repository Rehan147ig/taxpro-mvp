import { ZipArchive } from 'archiver';
import { Readable } from 'stream';
import { generateProvisionWorkbook } from './excel-generator.js';
import type { AuditTrailEntry } from './audit-log.js';

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
}

export async function generateWorkpaperPackage(input: WorkpaperPackageInput): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  // 1. Add the Excel workpaper
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
  archive.append(xlsxBuf, { name: `provision-${input.period}.xlsx` });

  // 2. Add audit trail CSV
  const auditCsv = buildAuditCsv(input.auditEntries);
  archive.append(auditCsv, { name: `audit-trail-${input.period}.csv` });

  // 3. Add summary text
  const summaryText = buildSummaryText(input);
  archive.append(summaryText, { name: 'package-summary.txt' });

  await archive.finalize();

  return Buffer.concat(chunks);
}

function buildAuditCsv(entries: AuditTrailEntry[]): string {
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

function buildSummaryText(input: WorkpaperPackageInput): string {
  return [
    `TaxPro Provision Package — Period: ${input.period}`,
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
    '',
    '--- Files ---',
    `provision-${input.period}.xlsx    — 4-tab Excel workpaper`,
    `audit-trail-${input.period}.csv   — Full audit trail`,
    '',
  ].join('\n');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
