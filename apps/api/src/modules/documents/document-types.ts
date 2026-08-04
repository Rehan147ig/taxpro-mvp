import { z } from 'zod';

/**
 * Controlled initial taxonomy of source-document types. Anything a firm
 * uploads that is not in this list is routed to review as 'other' —
 * unsupported types are never silently assumed to be a trial balance.
 */
export const DOCUMENT_TYPES = [
  'trial_balance',
  'prior_year_tax_computation',
  'ct600',
  'workpaper',
  'fixed_asset_schedule',
  'loss_schedule',
  'supporting_pdf',
  'other',
] as const;

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  trial_balance: 'Trial Balance',
  prior_year_tax_computation: 'Prior-Year Tax Computation',
  ct600: 'CT600',
  workpaper: 'Workpaper',
  fixed_asset_schedule: 'Fixed Asset Schedule',
  loss_schedule: 'Loss Schedule',
  supporting_pdf: 'Supporting Document',
  other: 'Other (manual review)',
};

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const PROVENANCE_SOURCES = [
  'manual_upload',
  'xero',
  'qbo',
  'csv_import',
  'interfaze',
] as const;

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function validateDocumentType(value: unknown): string {
  const v = String(value ?? '');
  if (!isDocumentType(v)) {
    throw new Error(
      `Unsupported document type '${v || '(empty)'}'. Supported: ${DOCUMENT_TYPES.join(', ')}. Unsupported artefacts must be classified as 'other' for manual review.`,
    );
  }
  return v;
}

export const documentMetadataSchema = z.object({
  documentType: z.string(),
  entityId: z.string().uuid().optional(),
  accountingPeriodId: z.string().uuid().optional(),
  taxPeriodId: z.string().uuid().optional(),
  provenance: z.enum(PROVENANCE_SOURCES).default('manual_upload'),
});
