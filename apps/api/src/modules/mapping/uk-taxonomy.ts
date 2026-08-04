/**
 * Controlled initial UK FRS 102 tax-classification taxonomy.
 *
 * This is the explicit, documented set of classifications the product
 * understands in Phase B. Anything a firm needs outside this list falls
 * back to MANUAL_REVIEW and is routed to a human — unsupported
 * classifications are never silently accepted or computed.
 */
export const UK_FRS102_CLASSIFICATIONS = [
  // No book/tax difference
  'NODIFF_REVENUE',
  'NODIFF_SALARIES',
  'NODIFF_RENT',
  // Temporary (timing) differences — deferred tax applies
  'TEMP_DEPRECIATION',
  'TEMP_BAD_DEBT_RESERVE',
  'TEMP_RESEARCH_CREDIT',
  'TEMP_DEFERRED_REVENUE',
  'TEMP_OTHER',
  // Permanent differences — ETR reconciliation, no deferred tax
  'PERM_MEALS_ENTERTAINMENT',
  'PERM_PENALTIES_FINES',
  'PERM_OTHER',
  // Explicit unsupported bucket — requires human classification
  'MANUAL_REVIEW',
] as const;

export function isUkClassification(value: string): boolean {
  return (UK_FRS102_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function validateUkClassification(value: string): string {
  const v = String(value ?? '').trim();
  if (!isUkClassification(v)) {
    return 'MANUAL_REVIEW';
  }
  return v;
}
