/**
 * Period validation for the UK tax-close domain.
 *
 * A UK corporation-tax accounting period (CTA 2010 s.10) must not exceed
 * 12 months. Periods of 3–12 months are normal (short first periods after
 * incorporation are common); anything shorter than 3 months or longer than
 * 12 months is non-standard and must be flagged for human review — the
 * system never silently assumes a 12-month period.
 */
export interface PeriodValidationResult {
  durationMonths: number;
  isStandardDuration: boolean;
  flags: string[];
}

export function parseDate(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

/** Whole months spanned from start to end (inclusive of the end day). */
export function computeDurationMonths(start: string, end: string): number {
  const s = parseDate(start);
  const e = parseDate(end);
  const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  const remainderDays = e.getUTCDate() - s.getUTCDate();
  return months + (remainderDays > 0 ? 1 : 0);
}

/** Minimum and maximum normal duration in months for a UK CT period. */
export const MIN_STANDARD_MONTHS = 3;
export const MAX_STANDARD_MONTHS = 12;

export function validatePeriodDates(start: string, end: string): PeriodValidationResult {
  const s = parseDate(start);
  const e = parseDate(end);
  if (e.getTime() <= s.getTime()) {
    throw new Error('Period end date must be after the start date');
  }
  const durationMonths = computeDurationMonths(start, end);
  const flags: string[] = [];
  if (durationMonths > MAX_STANDARD_MONTHS) {
    flags.push(`Period exceeds the ${MAX_STANDARD_MONTHS}-month maximum for a UK corporation-tax accounting period (${durationMonths} months). Requires manual review before any calculation.`);
  }
  if (durationMonths < MIN_STANDARD_MONTHS) {
    flags.push(`Period is unusually short (${durationMonths} month(s)). Requires manual review to confirm the intended close.`);
  }
  return { durationMonths, isStandardDuration: flags.length === 0, flags };
}
