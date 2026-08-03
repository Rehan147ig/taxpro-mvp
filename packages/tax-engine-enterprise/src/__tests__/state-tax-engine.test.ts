// Tests for the US state tax computation engine.
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. These tests verify the ARITHMETIC
// of the engine against its own ruleset data; they do not validate the data.

import { describe, expect, it } from 'vitest';
import { computeStateTaxes } from '../us/state-tax-engine.js';

const CA_FACTORS = {
  CA: {
    stateCode: 'CA',
    payrollInState: 250,
    payrollTotal: 1000,
    propertyInState: 100,
    propertyTotal: 1000,
    salesInState: 500,
    salesTotal: 1000,
  },
};

const AK_FACTORS = {
  AK: {
    stateCode: 'AK',
    payrollInState: 250,
    payrollTotal: 1000,
    propertyInState: 100,
    propertyTotal: 1000,
    salesInState: 500,
    salesTotal: 1000,
  },
};

describe('computeStateTaxes', () => {
  it('applies single-sales apportionment and the flat rate (CA)', () => {
    const r = computeStateTaxes({ apportionableIncome: 1_000_000, factorsByState: CA_FACTORS });
    expect(r.statesIncluded).toBe(1);
    const ca = r.states[0];
    expect(ca.status).toBe('computed');
    expect(ca.apportionmentFraction!.toFixed(6)).toBe('0.500000'); // single sales: 500/1000
    expect(ca.stateTaxableIncome!.toNumber()).toBe(500_000);
    expect(ca.rateApplied!.toNumber()).toBe(0.0884);
    expect(ca.stateTax!.toNumber()).toBeCloseTo(44_200, 6);
    expect(r.totalMultistateTax.toNumber()).toBeCloseTo(44_200, 6);
    expect(ca.warnings.some(w => /not modeled/.test(w))).toBe(true); // franchise add-on fidelity note
    expect(ca.warnings.some(w => /top tier/.test(w))).toBe(false); // CA is flat
  });

  it('uses equal three-factor for AK and brackets the total', () => {
    const r = computeStateTaxes({ apportionableIncome: 1_000_000, factorsByState: AK_FACTORS });
    const ak = r.states[0];
    // (0.25 + 0.10 + 0.50) / 3
    expect(ak.apportionmentFraction!.toFixed(6)).toBe('0.283333');
    expect(ak.stateTaxableIncome!.toNumber()).toBeCloseTo(283_333.33, 2);
    expect(ak.rateApplied!.toNumber()).toBe(0.09);
    expect(ak.stateTax!.toNumber()).toBeCloseTo(25_500, 6);
    expect(ak.warnings.some(w => /top tier/.test(w))).toBe(true); // bracketed warning
  });

  it('sums multiple states into the multistate total', () => {
    const r = computeStateTaxes({
      apportionableIncome: 1_000_000,
      factorsByState: { ...CA_FACTORS, ...AK_FACTORS },
    });
    expect(r.states).toHaveLength(2);
    expect(r.statesIncluded).toBe(2);
    expect(r.totalMultistateTax.toNumber()).toBeCloseTo(44_200 + 25_500, 6);
  });

  it('excludes no-CIT jurisdictions with zero tax', () => {
    const r = computeStateTaxes({
      apportionableIncome: 1_000_000,
      factorsByState: { SD: { stateCode: 'SD', payrollInState: 0, payrollTotal: 0, propertyInState: 0, propertyTotal: 0, salesInState: 0, salesTotal: 0 } },
    });
    expect(r.states[0].status).toBe('no_cit');
    expect(r.states[0].stateTax).toBeNull();
    expect(r.statesIncluded).toBe(0);
    expect(r.totalMultistateTax.toNumber()).toBe(0);
  });

  it('reports gross-receipts states as not income-based', () => {
    const r = computeStateTaxes({
      apportionableIncome: 1_000_000,
      factorsByState: { TX: { stateCode: 'TX', payrollInState: 0, payrollTotal: 100, propertyInState: 0, propertyTotal: 100, salesInState: 0, salesTotal: 100 } },
    });
    expect(r.states[0].status).toBe('not_income_based');
    expect(r.states[0].reason).toMatch(/gross receipts\/margin/);
    expect(r.statesIncluded).toBe(0);
  });

  it('excludes states lacking factor data instead of dropping them silently', () => {
    const r = computeStateTaxes({
      apportionableIncome: 1_000_000,
      factorsByState: {
        CA: CA_FACTORS.CA,
        NY: { stateCode: 'NY', payrollInState: 0, payrollTotal: 0, propertyInState: 0, propertyTotal: 0, salesInState: 0, salesTotal: 0 },
      },
    });
    const ny = r.states.find(s => s.stateCode === 'NY');
    expect(ny?.status).toBe('insufficient_factors');
    expect(ny?.reason).toMatch(/no activity|zero/i);
    expect(r.statesIncluded).toBe(1);
  });

  it('honors rate and weight overrides', () => {
    const r = computeStateTaxes({
      apportionableIncome: 1_000_000,
      factorsByState: CA_FACTORS,
      rateOverrideByState: { CA: '0.10' },
      weightOverrideByState: { CA: { payroll: '1', property: '0', sales: '0' } },
    });
    const ca = r.states[0];
    expect(ca.apportionmentFraction!.toFixed(6)).toBe('0.250000'); // payroll-only weight
    expect(ca.stateTax!.toNumber()).toBeCloseTo(25_000, 6); // 250k × 10%
    expect(ca.rateApplied!.toNumber()).toBe(0.1);
  });

  it('floors negative state taxable income at zero with a warning', () => {
    const r = computeStateTaxes({ apportionableIncome: -100_000, factorsByState: CA_FACTORS });
    expect(r.states[0].stateTax!.toNumber()).toBe(0);
    expect(r.warnings.some(w => /negative state taxable income/.test(w))).toBe(true);
  });

  it('warns when a state has no ruleset entry', () => {
    const r = computeStateTaxes({
      apportionableIncome: 1_000_000,
      factorsByState: { ZZ: { stateCode: 'ZZ', payrollInState: 0, payrollTotal: 100, propertyInState: 0, propertyTotal: 100, salesInState: 0, salesTotal: 100 } },
    });
    expect(r.warnings.some(w => /no ruleset/.test(w))).toBe(true);
    expect(r.statesIncluded).toBe(0);
  });

  it('returns a basis statement naming the UNVALIDATED contract', () => {
    const r = computeStateTaxes({ apportionableIncome: 1000, factorsByState: CA_FACTORS });
    expect(r.basis).toMatch(/UNVALIDATED/);
    expect(r.basis).toMatch(/STATE_RULESET/);
  });
});
