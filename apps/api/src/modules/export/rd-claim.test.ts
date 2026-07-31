import { describe, expect, it } from 'vitest';
import { buildRdClaimPackage, RD_CONFIG, rdClaimFromProvisionDetail } from './rd-claim.js';

const BASE = {
  taxableProfit: 480000,
  payeAndNicLiability: 40000,
  headcount: 120,
  totalCosts: 3_000_000,
  isLossMaking: false,
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
};

describe('SME scheme (profit-making)', () => {
  it('computes the 86% enhancement and relief at 19%', () => {
    const p = buildRdClaimPackage({ ...BASE, qualifyingExpenditure: 100000 });
    expect(p.scheme).toBe('sme');
    expect(p.calculations.enhancement).toBe(86000);
    expect(p.calculations.enhancedExpenditure).toBe(186000);
    expect(p.calculations.reliefDeduction).toBe(186000);
    expect(p.calculations.benefitFromDeduction).toBeCloseTo(35340, 2);
    expect(p.calculations.totalBenefit).toBeCloseTo(35340, 2);
    expect(p.ct600.box28).toBe(0);
    expect(p.disclaimer).toContain('19% relief');
  });
});

describe('SME scheme (loss-making)', () => {
  it('computes the surrender credit at 10%, capped by £20k + 3× PAYE', () => {
    const p = buildRdClaimPackage({ ...BASE, isLossMaking: true, qualifyingExpenditure: 100000 });
    expect(p.scheme).toBe('sme');
    expect(p.calculations.creditRate).toBe(0.10);
    expect(p.calculations.creditAmount).toBe(18600);
    expect(p.calculations.payeCap).toBe(20000 + 3 * 40000); // £140k cap
    expect(p.calculations.payableCredit).toBe(18600);
    expect(p.calculations.totalBenefit).toBe(18600);
    expect(p.ct600.box28).toBe(18600);
  });

  it('applies the £20k floor cap when gross credit exceeds the PAYE formula', () => {
    const p = buildRdClaimPackage({ ...BASE, isLossMaking: true, qualifyingExpenditure: 1000000, totalCosts: 10_000_000 });
    expect(p.calculations.creditRate).toBe(0.10);
    expect(p.calculations.creditAmount).toBe(186000);
    expect(p.calculations.payeCap).toBe(140000);
    expect(p.calculations.payableCredit).toBe(140000);
  });

  it('uses the 27% intensive credit for intensive loss-making SMEs', () => {
    const p = buildRdClaimPackage({
      ...BASE,
      isLossMaking: true,
      qualifyingExpenditure: 1_200_000,
      totalCosts: 2_000_000, // 60% intensity ≥ 30%
    });
    expect(p.eligibility.isIntensive).toBe(true);
    expect(p.eligibility.intensiveSmeCredit).toBe(true);
    expect(p.calculations.creditRate).toBe(0.27);
    expect(p.calculations.creditAmount).toBeCloseTo(602640, 2);
    expect(p.calculations.payableCredit).toBe(140000); // capped by £20k + 3× PAYE
  });
});

describe('Merged RDEC', () => {
  it('applies 20% above-the-line credit and taxes it at 25%', () => {
    const p = buildRdClaimPackage({ ...BASE, scheme: 'rdec', qualifyingExpenditure: 500000 });
    expect(p.scheme).toBe('rdec');
    expect(p.calculations.creditAmount).toBe(100000);
    expect(p.calculations.netCreditAfterTax).toBe(75000);
    expect(p.calculations.totalBenefit).toBe(75000);
    expect(p.ct600.box27).toBe(100000);
  });

  it('defaults large companies to the merged scheme', () => {
    const p = buildRdClaimPackage({ ...BASE, headcount: 500, qualifyingExpenditure: 100000 });
    expect(p.scheme).toBe('rdec');
  });
});

describe('validation + helpers', () => {
  it('rejects negative qualifying expenditure', () => {
    expect(() => buildRdClaimPackage({ ...BASE, qualifyingExpenditure: -5 }))
      .toThrow(/cannot be negative/);
  });

  it('rdClaimFromProvisionDetail wires a detail-sourced qualifying spend', () => {
    const p = rdClaimFromProvisionDetail({ ...BASE, qualifyingExpenditure: 0 }, 50000);
    expect(p.qualifyingExpenditure).toBe(50000);
    expect(p.calculations.enhancement).toBe(43000);
  });

  it('exposes budget-time rate knobs', () => {
    expect(RD_CONFIG.MERGED_RDEC_RATE).toBe(0.20);
    expect(RD_CONFIG.INTENSIVE_SME_CREDIT_RATE).toBe(0.27);
    expect(RD_CONFIG.INTENSITY_THRESHOLD).toBe(0.30);
  });
});

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
