import { describe, expect, it } from 'vitest';
import { buildCt600Return } from './ct600.js';
import { validateCt600Return, type Ct600Violation } from './ct600-validation.js';

const COMPANY = { companyName: 'Greggs plc (Demo)', utr: '1234567890', companiesHouseNumber: '00502851' };
const PERIOD = { start: '2025-01-01', end: '2025-12-31' };

function validReturn(overrides: Partial<Parameters<typeof buildCt600Return>[2]> = {}) {
  return buildCt600Return({ ...COMPANY }, PERIOD, {
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
    ...overrides,
  });
}

function setBox(r: ReturnType<typeof buildCt600Return>, n: number, value: string | number) {
  r.boxes.find(b => b.box === n)!.value = value;
  return r;
}

const ruleIds = (v: Ct600Violation[]) => v.map(x => x.ruleId);

describe('validateCt600Return — HMRC conformance', () => {
  it('passes the HMRC published marginal relief example (£125,000 → £29,375)', () => {
    const res = validateCt600Return(validReturn());
    expect(res.valid).toBe(true);
    expect(res.violations).toHaveLength(0);
    expect(res.rulesRun).toBeGreaterThan(10);
  });

  it('passes the HMRC worked £100,000 example (MR £2,250, charge £22,750)', () => {
    const r = validReturn({
      profitsChargeableToCT: 100000,
      taxableTotalProfits: 100000,
      taxAtMainRate: 25000,
      marginalRelief: 2250,
    });
    expect(validateCt600Return(r).valid).toBe(true);
  });

  it('passes the small profits rate band (19% below £50,000)', () => {
    const r = validReturn({
      profitsChargeableToCT: 45000,
      taxableTotalProfits: 45000,
      taxAtMainRate: 0,
      taxAtSmallProfitsRate: 8550,
      marginalRelief: 0,
    });
    expect(validateCt600Return(r).valid).toBe(true);
  });

  it('passes the main rate band (25% above £250,000)', () => {
    const r = validReturn({
      profitsChargeableToCT: 497000,
      taxableTotalProfits: 497000,
      taxAtMainRate: 124250,
      marginalRelief: 0,
    });
    expect(validateCt600Return(r).valid).toBe(true);
  });

  it('passes a flat 19% return for FY2022 and earlier', () => {
    const r = buildCt600Return({ ...COMPANY }, { start: '2022-01-01', end: '2022-12-31' }, {
      profitsChargeableToCT: 90000,
      taxableTotalProfits: 90000,
      taxAtMainRate: 17100,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 0,
      taxCredits: 0,
      taxDeductedAtSource: 0,
      paymentsOnAccount: 0,
      rdSurrender: 0,
      rdec: 0,
    });
    const res = validateCt600Return(r);
    expect(res.valid).toBe(true);
    const skipped = res.skipped.map(s => s.ruleId);
    expect(skipped).toContain('MARGINAL_RELIEF_ALIGNMENT');
    expect(skipped).toContain('MAIN_RATE_ALIGNMENT');
    expect(res.skipped[0].reason).toContain('flat 19%');
  });

  it('skips rate rules (with reason) for a period straddling 1 April 2023', () => {
    const r = validReturn({ taxAtMainRate: 31250, marginalRelief: 1875 });
    r.period = { start: '2023-01-01', end: '2023-12-31' };
    setBox(r, 3, '2023-01-01');
    setBox(r, 4, '2023-12-31');
    const res = validateCt600Return(r);
    expect(res.valid).toBe(true);
    const skipped = res.skipped.map(s => s.ruleId);
    expect(skipped).toContain('MARGINAL_RELIEF_ALIGNMENT');
    expect(res.skipped[0].reason).toContain('straddles');
  });

  it('rejects a malformed UTR', () => {
    const r = setBox(validReturn(), 1, '123456');
    const res = validateCt600Return(r);
    expect(res.valid).toBe(false);
    expect(ruleIds(res.violations)).toContain('UTR_FORMAT');
  });

  it('rejects a malformed Companies House number', () => {
    const r = validReturn();
    r.company.companiesHouseNumber = 'XX-1234567';
    const res = validateCt600Return(r);
    expect(res.valid).toBe(false);
    expect(ruleIds(res.violations)).toContain('COMPANY_NUMBER_FORMAT');
  });

  it('rejects a broken Box 15 identity', () => {
    const r = setBox(validReturn(), 15, 29300); // should be 29375
    const res = validateCt600Return(r);
    expect(res.valid).toBe(false);
    expect(ruleIds(res.violations)).toContain('BOX15_IDENTITY');
  });

  it('rejects an inconsistent marginal relief figure', () => {
    const r = setBox(validReturn(), 14, 937.5); // correct relief is 1875
    const res = validateCt600Return(r);
    expect(res.valid).toBe(false);
    const violation = res.violations.find(v => v.ruleId === 'MARGINAL_RELIEF_ALIGNMENT');
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('3/200 × (£250,000');
  });

  it('rejects both rate boxes populated (band selection)', () => {
    const r = setBox(validReturn(), 13, 5000);
    const res = validateCt600Return(r);
    expect(res.valid).toBe(false);
    expect(ruleIds(res.violations)).toContain('BAND_SELECTION');
  });

  it('rejects Box 5 ≠ Box 10', () => {
    const r = setBox(validReturn(), 10, 120000);
    const res = validateCt600Return(r);
    expect(ruleIds(res.violations)).toContain('BOX5_EQ_BOX10');
  });

  it('rejects negative amounts', () => {
    const r = setBox(validReturn(), 27, -5);
    const res = validateCt600Return(r);
    expect(res.valid).toBe(false);
    expect(ruleIds(res.violations)).toContain('NON_NEGATIVE');
  });

  it('rejects an inverted or over-long accounting period', () => {
    const inverted = setBox(validReturn(), 4, '2024-12-31');
    const invertedRes = validateCt600Return(inverted);
    expect(ruleIds(invertedRes.violations)).toContain('PERIOD_ORDER');

    const tooLong = setBox(validReturn(), 4, '2026-12-31'); // 2 years
    const tooLongRes = validateCt600Return(tooLong);
    expect(ruleIds(tooLongRes.violations)).toContain('PERIOD_LENGTH');
  });

  it('rejects a wrong small-profits-rate charge', () => {
    const r = validReturn({
      profitsChargeableToCT: 45000,
      taxableTotalProfits: 45000,
      taxAtMainRate: 0,
      taxAtSmallProfitsRate: 9000, // should be 8550
      marginalRelief: 0,
    });
    const res = validateCt600Return(r);
    expect(ruleIds(res.violations)).toContain('SMALL_RATE_ALIGNMENT');
  });

  it('accepts credits and payments on account flows', () => {
    const r = validReturn({
      taxCredits: 2000,
      taxDeductedAtSource: 500,
      paymentsOnAccount: 10000,
    });
    const res = validateCt600Return(r);
    expect(res.valid).toBe(true);
  });
});
