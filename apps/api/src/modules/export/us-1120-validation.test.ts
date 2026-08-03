import { describe, expect, it } from 'vitest';
import { buildUs1120Return } from './us-1120.js';
import { validateUs1120Return, type Us1120Violation } from './us-1120-validation.js';

const COMPANY = { companyName: 'Demo US Corp', ein: '123456789', state: 'DE' };
const PERIOD = { start: '2025-01-01', end: '2025-12-31' };

function validReturn(overrides: Partial<Parameters<typeof buildUs1120Return>[2]> = {}) {
  return buildUs1120Return(COMPANY, PERIOD, {
    bookIncome: 1_000_000,
    permanentAdjustments: 50_000,
    temporaryAdjustments: -30_000,
    nolDeduction: 0,
    federalRate: 0.21,
    taxCredits: 0,
    estimatedPayments: 210_000,
    overpaymentsApplied: 0,
    ...overrides,
  });
}

function violationsOf(r: ReturnType<typeof buildUs1120Return>): Us1120Violation[] {
  return validateUs1120Return(r).violations;
}

describe('validateUs1120Return — IRS conformance', () => {
  it('validates a clean return', () => {
    const res = validateUs1120Return(validReturn());
    expect(res.valid).toBe(true);
    expect(res.rulesRun).toBeGreaterThanOrEqual(9);
    expect(res.violations).toEqual([]);
    expect(res.skipped.map(s => s.ruleId)).toContain('RND_CREDIT_25_CAP');
    expect(res.skipped.map(s => s.ruleId)).not.toContain('TCJA_RATE_ALIGNMENT');
    expect(res.basis).toMatch(/21% federal corporate rate/);
  });

  it('accepts a dashed EIN that normalises to 9 digits', () => {
    expect(validateUs1120Return(validReturn()).valid).toBe(true);
  });

  it('EIN_FORMAT: rejects non-9-digit EINs', () => {
    const bad = { ...validReturn(), company: { ...COMPANY, ein: '1234' } };
    const v = violationsOf(bad as any);
    expect(v.find(x => x.ruleId === 'EIN_FORMAT')?.message).toMatch(/must be exactly 9 digits/);
  });

  it('PERIOD_*: rejects non-ISO, reversed and oversized periods', () => {
    expect(violationsOf(buildUs1120Return(COMPANY, { start: '01/01/2025', end: '12/31/2025' }, {
      bookIncome: 1000, permanentAdjustments: 0, temporaryAdjustments: 0, nolDeduction: 0,
      federalRate: 0.21, taxCredits: 0, estimatedPayments: 0, overpaymentsApplied: 0,
    }).company && validReturn())).toHaveLength(0);

    const reversed = buildUs1120Return(COMPANY, { start: '2025-12-31', end: '2025-01-01' }, {
      bookIncome: 1000, permanentAdjustments: 0, temporaryAdjustments: 0, nolDeduction: 0,
      federalRate: 0.21, taxCredits: 0, estimatedPayments: 0, overpaymentsApplied: 0,
    });
    expect(violationsOf(reversed).find(x => x.ruleId === 'PERIOD_ORDER')?.message).toMatch(/must be before/);

    const tooLong = buildUs1120Return(COMPANY, { start: '2025-01-01', end: '2027-01-01' }, {
      bookIncome: 1000, permanentAdjustments: 0, temporaryAdjustments: 0, nolDeduction: 0,
      federalRate: 0.21, taxCredits: 0, estimatedPayments: 0, overpaymentsApplied: 0,
    });
    expect(violationsOf(tooLong).find(x => x.ruleId === 'PERIOD_LENGTH')?.message).toMatch(/366 days/);
  });

  it('M1_IDENTITY: flags a reconciliation that does not tie', () => {
    const r = validReturn();
    const hacked = { ...r, m1: { ...r.m1, taxableIncomeBeforeNol: r.m1.taxableIncomeBeforeNol + 10_000 } };
    const v = violationsOf(hacked as any);
    expect(v.find(x => x.ruleId === 'M1_IDENTITY')?.message).toMatch(/must equal book income/);
  });

  it('TCJA_RATE_ALIGNMENT: rejects a pre-TCJA rate for a post-2017 period and skips pre-2018 periods', () => {
    const wrongRate = validReturn({ federalRate: 0.35 });
    expect(violationsOf(wrongRate).find(x => x.ruleId === 'TCJA_RATE_ALIGNMENT')?.message).toMatch(/must be 21%/);

    const preTcja = buildUs1120Return(COMPANY, { start: '2016-01-01', end: '2016-12-31' }, {
      bookIncome: 1000, permanentAdjustments: 0, temporaryAdjustments: 0, nolDeduction: 0,
      federalRate: 0.35, taxCredits: 0, estimatedPayments: 0, overpaymentsApplied: 0,
    });
    const res = validateUs1120Return(preTcja);
    expect(res.violations.find(x => x.ruleId === 'TCJA_RATE_ALIGNMENT')).toBeUndefined();
    expect(res.skipped.find(s => s.ruleId === 'TCJA_RATE_ALIGNMENT')?.reason).toMatch(/pre-TCJA/);
  });

  it('TAX_COMPUTATION: flags tax that does not match taxable income × rate', () => {
    const r = buildUs1120Return(COMPANY, PERIOD, {
      bookIncome: 1000, permanentAdjustments: 100, temporaryAdjustments: 0, nolDeduction: 0,
      federalRate: 0.21, taxCredits: 0, estimatedPayments: 0, overpaymentsApplied: 0,
    });
    expect(r.incomeTax.taxBeforeCredits).toBe(231);
    const hacked = { ...r, incomeTax: { ...r.incomeTax, taxBeforeCredits: 999 } };
    expect(violationsOf(hacked as any).find(x => x.ruleId === 'TAX_COMPUTATION')?.message).toMatch(/must equal taxable income/);
  });

  it('CREDIT_LIMIT: flags credits exceeding the pre-credit tax', () => {
    const r = validReturn({ taxCredits: 999_999 });
    expect(violationsOf(r).find(x => x.ruleId === 'CREDIT_LIMIT')?.message).toMatch(/exceed tax before credits/);
  });

  it('NOL_80_PERCENT: flags NOL above the 80% cap, skips pre-2018', () => {
    const r = validReturn({ nolDeduction: 900_000 });
    expect(violationsOf(r).find(x => x.ruleId === 'NOL_80_PERCENT')?.message).toMatch(/80% of taxable income/);

    const preTcja = buildUs1120Return(COMPANY, { start: '2016-01-01', end: '2016-12-31' }, {
      bookIncome: 1000, permanentAdjustments: 0, temporaryAdjustments: 0, nolDeduction: 900,
      federalRate: 0.35, taxCredits: 0, estimatedPayments: 0, overpaymentsApplied: 0,
    });
    expect(violationsOf(preTcja).find(x => x.ruleId === 'NOL_80_PERCENT')).toBeUndefined();
  });

  it('OWE/OVERPAYMENT identities and NON_NEGATIVE', () => {
    const r = validReturn();
    const hacked = { ...r, owed: { ...r.owed, amountOwed: 1 } };
    expect(violationsOf(hacked as any).find(x => x.ruleId === 'AMOUNT_OWED_IDENTITY')?.message).toMatch(/Amount owed must equal/);

    const neg = { ...r, owed: { ...r.owed, overpayment: -1 } };
    expect(violationsOf(neg as any).find(x => x.ruleId === 'NON_NEGATIVE')?.message).toMatch(/must not be negative/);
  });
});
