import { describe, expect, it } from 'vitest';
import { buildCt600Return, ct600FromProvisionDetail, ct600ToCsv } from './ct600.js';

const COMPANY = { companyName: 'Greggs plc (Demo)', utr: '1234567890', companiesHouseNumber: '00502851' };
const PERIOD = { start: '2025-01-01', end: '2025-12-31' };

describe('buildCt600Return', () => {
  it('computes the tax charge and balance from the box inputs', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 497000,
      taxableTotalProfits: 497000,
      taxAtMainRate: 124250,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 0,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 28250,
      rdSurrender: 0,
      rdec: 0,
    });
    expect(r.computed.totalTaxCharge).toBe(124250);
    expect(r.computed.taxPayable).toBe(124250);
    expect(r.computed.balanceDue).toBe(96000);
    expect(r.consistency.ok).toBe(true);
    expect(r.boxes.find(b => b.box === 15)?.value).toBe(124250);
    expect(r.boxes.find(b => b.box === 22)?.value).toBe(96000);
  });

  it('applies marginal relief in the charge calculation', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 125000,
      taxableTotalProfits: 125000,
      taxAtMainRate: 31250,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 1875,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 0,
      rdSurrender: 0,
      rdec: 0,
    });
    expect(r.computed.totalTaxCharge).toBe(29375); // HMRC published example
    expect(r.consistency.ok).toBe(true);
  });

  it('small profits rate band: sub-£50k profits charge 19% with no marginal relief', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 45000,
      taxableTotalProfits: 45000,
      taxAtMainRate: 0,
      taxAtSmallProfitsRate: 8550, // 45,000 × 19%
      marginalRelief: 0,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 0,
      rdSurrender: 0,
      rdec: 0,
    });
    expect(r.computed.totalTaxCharge).toBe(8550);
    expect(r.boxes.find(b => b.box === 13)?.value).toBe(8550);
    expect(r.boxes.find(b => b.box === 12)?.value).toBe(0);
    expect(r.boxes.find(b => b.box === 14)?.value).toBe(0);
    expect(r.consistency.ok).toBe(true);
  });

  it('carries R&D expenditure credit (RDEC) and surrendered-loss boxes', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 100000,
      taxableTotalProfits: 100000,
      taxAtMainRate: 25000,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 0,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 0,
      rdSurrender: 15000,
      rdec: 2000,
    });
    expect(r.computed.totalTaxCharge).toBe(25000);
    expect(r.boxes.find(b => b.box === 27)?.value).toBe(2000);
    expect(r.boxes.find(b => b.box === 28)?.value).toBe(15000);
    expect(r.consistency.ok).toBe(true);
  });

  it('zeroes the charge on a loss year and flags it', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 0,
      taxableTotalProfits: 0,
      taxAtMainRate: 0,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 5000,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 0,
      rdSurrender: 0,
      rdec: 0,
    });
    expect(r.computed.totalTaxCharge).toBe(0);
    expect(r.computed.balanceDue).toBe(0);
    expect(r.consistency.ok).toBe(false);
    expect(r.consistency.issues.some(i => i.includes('Negative tax charge'))).toBe(true);
  });

  it('credits exceeding the charge zero the payable — never negative (no hidden repayment)', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 20000,
      taxableTotalProfits: 20000,
      taxAtMainRate: 5000,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 0,
      taxCredits: 8000,
      taxDeductedAtSource: 1000,
      paymentsOnAccount: 0,
      rdSurrender: 0,
      rdec: 0,
    });
    expect(r.computed.totalTaxCharge).toBe(5000);
    expect(r.computed.taxPayable).toBe(0); // 5000 - 8000 - 1000 < 0 -> floored at 0
    expect(r.computed.balanceDue).toBe(0);
    expect(r.computed.taxPayable).toBeGreaterThanOrEqual(0);
    expect(r.consistency.ok).toBe(true);
  });

  it('payments on account exceeding payable zero the balance — never negative', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 20000,
      taxableTotalProfits: 20000,
      taxAtMainRate: 5000,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 0,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 10000,
      rdSurrender: 0,
      rdec: 0,
    });
    expect(r.computed.taxPayable).toBe(5000);
    expect(r.computed.balanceDue).toBe(0);
    expect(r.computed.balanceDue).toBeGreaterThanOrEqual(0);
    expect(r.consistency.ok).toBe(true);
  });

  it('box values are internally consistent (charge = main + small - relief; balance = payable - POA)', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 125000,
      taxableTotalProfits: 125000,
      taxAtMainRate: 31250,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 1875,
      taxCredits: 2000,
      taxDeductedAtSource: 500,
      paymentsOnAccount: 10000,
      rdSurrender: 0,
      rdec: 0,
    });
    const box = (n: number) => Number(r.boxes.find(b => b.box === n)?.value ?? 0);
    expect(box(15)).toBe(r.computed.totalTaxCharge);
    expect(box(19)).toBe(r.computed.taxPayable);
    expect(box(22)).toBe(r.computed.balanceDue);
    expect(r.computed.totalTaxCharge).toBe(29375);
    expect(r.computed.taxPayable).toBe(26875);
    expect(r.computed.balanceDue).toBe(16875);
  });

  it('deducts R&D credits and payments on account', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 100000,
      taxableTotalProfits: 100000,
      taxAtMainRate: 22750,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 2250,
      taxCredits: 5000,
      taxDeductedAtSource: 1000,
      paymentsOnAccount: 8000,
      rdSurrender: 0,
      rdec: 0,
    });
    expect(r.computed.totalTaxCharge).toBe(20500);
    expect(r.computed.taxPayable).toBe(14500);
    expect(r.computed.balanceDue).toBe(6500);
  });

  it('flags inconsistent band selections', () => {
    const r = buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 100000,
      taxableTotalProfits: 100000,
      taxAtMainRate: 20000,
      taxAtSmallProfitsRate: 5000,
      marginalRelief: 1000,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 0,
      rdSurrender: 0,
      rdec: 0,
    });
    expect(r.consistency.ok).toBe(false);
    expect(r.consistency.issues.some(i => i.includes('Both main and small profits'))).toBe(true);
  });

  it('rejects negative inputs', () => {
    expect(() => buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: -1,
      taxableTotalProfits: 0,
      taxAtMainRate: 0,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 0,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 0,
      rdSurrender: 0,
      rdec: 0,
    })).toThrow(/negative/);
  });
});

describe('ct600FromProvisionDetail', () => {
  it('maps a provision detail (with marginal relief) into CT600 figures', () => {
    const r = ct600FromProvisionDetail(COMPANY, PERIOD, {
      currentTax: {
        bookIncome: 125000,
        totalPermanentAdjustments: 0,
        taxableIncome: 125000,
        federalTax: 31250,
        marginalRelief: 1875,
        taxCredits: 0,
        taxPayable: 29375,
        estimatedPayments: 0,
        totalTaxAfterCredits: 29375,
      },
    });
    expect(r.boxes.find(b => b.box === 5)?.value).toBe(125000);
    expect(r.boxes.find(b => b.box === 14)?.value).toBe(1875);
    expect(r.computed.totalTaxCharge).toBe(29375);
  });
});

describe('ct600ToCsv', () => {
  it('renders an escaped CSV with header', () => {
    const csv = ct600ToCsv(buildCt600Return(COMPANY, PERIOD, {
      profitsChargeableToCT: 100,
      taxableTotalProfits: 100,
      taxAtMainRate: 25,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 0,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 0,
      rdSurrender: 0,
      rdec: 0,
    }));
    const lines = csv.split('\n');
    expect(lines[0]).toBe('box,name,value');
    expect(lines.length).toBe(1 + 17);
    expect(lines.some(l => l.includes('Taxable total profits'))).toBe(true);
  });
});
