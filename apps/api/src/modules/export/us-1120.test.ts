import { describe, expect, it } from 'vitest';
import { buildUs1120Return, us1120FromProvisionDetail, us1120ToCsv } from './us-1120.js';

const COMPANY = { companyName: 'Demo US Corp', ein: '12-3456789', state: 'DE' };
const PERIOD = { start: '2025-01-01', end: '2025-12-31' };

const BASE = {
  bookIncome: 1_000_000,
  permanentAdjustments: 50_000,
  temporaryAdjustments: -30_000,
  nolDeduction: 0,
  federalRate: 0.21,
  taxCredits: 0,
  estimatedPayments: 210_000,
  overpaymentsApplied: 0,
};

describe('buildUs1120Return', () => {
  it('reconciles book to taxable income via M-1-style adjustments', () => {
    const r = buildUs1120Return(COMPANY, PERIOD, BASE);
    expect(r.m1.taxableIncomeBeforeNol).toBe(1_020_000); // 1,000,000 + 50,000 − 30,000
    expect(r.incomeTax.taxableIncome).toBe(1_020_000);
    expect(r.incomeTax.taxBeforeCredits).toBe(214_200); // 1,020,000 × 21%
    expect(r.incomeTax.totalTax).toBe(214_200);
    expect(r.owed.amountOwed).toBe(4_200); // 214,200 − 210,000
    expect(r.owed.overpayment).toBe(0);
    expect(r.company.ein).toBe('123456789'); // dashes stripped
    expect(r.consistency.ok).toBe(true);
  });

  it('applies credits and the NOL deduction', () => {
    const r = buildUs1120Return(COMPANY, PERIOD, { ...BASE, taxCredits: 50_000, nolDeduction: 200_000 });
    expect(r.incomeTax.taxableIncome).toBe(820_000); // 1,020,000 − 200,000
    expect(r.incomeTax.totalTax).toBe(122_200); // 820,000 × 21% − 50,000
    expect(r.consistency.ok).toBe(true);
  });

  it('floors credits over the charge at zero and flags for review', () => {
    const r = buildUs1120Return(COMPANY, PERIOD, { ...BASE, taxCredits: 999_999 });
    expect(r.incomeTax.totalTax).toBe(0);
    expect(r.owed.amountOwed).toBe(0);
    expect(r.owed.overpayment).toBe(210_000);
    expect(r.consistency.ok).toBe(false);
    expect(r.consistency.issues[0]).toMatch(/exceed tax before credits/i);
  });

  it('loss year: taxable income and tax floor at zero', () => {
    const r = buildUs1120Return(COMPANY, PERIOD, { ...BASE, bookIncome: -100_000, estimatedPayments: 0 });
    expect(r.incomeTax.taxableIncomeBeforeNol).toBe(-80_000);
    expect(r.incomeTax.taxableIncome).toBe(0);
    expect(r.incomeTax.totalTax).toBe(0);
    expect(r.consistency.ok).toBe(false);
  });

  it('flags NOL above the 80% IRC 172(a) limitation', () => {
    const r = buildUs1120Return(COMPANY, PERIOD, { ...BASE, nolDeduction: 900_000 });
    expect(r.consistency.ok).toBe(false);
    expect(r.consistency.issues[0]).toMatch(/80% of taxable income/i);
  });

  it('flags a non-21% rate in a TCJA period', () => {
    const r = buildUs1120Return(COMPANY, PERIOD, { ...BASE, federalRate: 0.35 });
    expect(r.consistency.ok).toBe(false);
    expect(r.consistency.issues[0]).toMatch(/statutory rate is 21%/i);
  });

  it('rejects malformed inputs', () => {
    expect(() => buildUs1120Return({ ...COMPANY, ein: '123' }, PERIOD, BASE)).toThrow('ein must be 9 digits');
    expect(() => buildUs1120Return(COMPANY, PERIOD, { ...BASE, nolDeduction: -1 })).toThrow('nolDeduction cannot be negative');
    expect(() => buildUs1120Return(COMPANY, PERIOD, { ...BASE, federalRate: 1.5 })).toThrow('federalRate must be between 0 and 1');
    expect(() => buildUs1120Return(COMPANY, PERIOD, { ...BASE, taxCredits: -1 })).toThrow('taxCredits cannot be negative');
  });

  it('derives inputs from a provision detail with net temporary differences as the balancing figure', () => {
    const r = us1120FromProvisionDetail(COMPANY, PERIOD, {
      currentTax: {
        bookIncome: 1_000_000,
        totalPermanentAdjustments: 50_000,
        taxableIncome: 1_020_000,
        federalTax: 214_200,
        taxCredits: 10_000,
        estimatedPayments: 200_000,
        totalTaxAfterCredits: 204_200,
      },
    });
    expect(r.m1.temporaryAdjustments).toBe(-30_000);
    expect(r.incomeTax.taxBeforeCredits).toBe(214_200);
    expect(r.incomeTax.totalTax).toBe(204_200);
    expect(r.owed.amountOwed).toBe(4_200);
  });
});

describe('us1120ToCsv', () => {
  it('renders one line per 1120/M-1 row', () => {
    const csv = us1120ToCsv(buildUs1120Return(COMPANY, PERIOD, BASE));
    const rows = csv.trim().split('\n');
    expect(rows[0]).toBe('line,name,value');
    expect(rows).toHaveLength(1 + 15);
    expect(rows[1]).toBe('M-1.1,Net income (loss) per books,1000000');
    expect(rows[rows.length - 1]).toContain('Amount you overpaid');
  });
});
