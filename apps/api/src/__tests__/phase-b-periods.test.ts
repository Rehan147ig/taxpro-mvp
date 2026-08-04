import { describe, it, expect } from 'vitest';
import { validatePeriodDates, computeDurationMonths } from '../modules/periods/period-validation.js';

describe('Phase B — tax period validation (no hard-coded 12 months)', () => {

  it('a standard 12-month period is standard', () => {
    const r = validatePeriodDates('2026-01-01', '2026-12-31');
    expect(r.durationMonths).toBe(12);
    expect(r.isStandardDuration).toBe(true);
    expect(r.flags).toEqual([]);
  });

  it('a short first period (3–12 months) is accepted as standard', () => {
    const r = validatePeriodDates('2026-10-01', '2027-03-31');
    expect(r.isStandardDuration).toBe(true);
  });

  it('a period over 12 months is flagged for review with a clear reason', () => {
    const r = validatePeriodDates('2025-01-01', '2026-12-31');
    expect(r.isStandardDuration).toBe(false);
    expect(r.flags.join(' ')).toContain('12-month maximum');
    expect(r.durationMonths).toBeGreaterThan(12);
  });

  it('an unusually short period is flagged for review', () => {
    const r = validatePeriodDates('2026-06-01', '2026-07-31');
    expect(r.isStandardDuration).toBe(false);
    expect(r.flags.join(' ')).toContain('unusually short');
  });

  it('rejects end dates at or before the start date', () => {
    expect(() => validatePeriodDates('2026-12-31', '2026-12-31')).toThrow(/must be after/);
    expect(() => validatePeriodDates('2026-12-31', '2026-01-01')).toThrow(/must be after/);
  });

  it('computeDurationMonths spans year boundaries', () => {
    expect(computeDurationMonths('2025-04-06', '2026-04-05')).toBe(12);
  });
});
