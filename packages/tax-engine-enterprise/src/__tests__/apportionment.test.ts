// Tests for the US apportionment skeleton.
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.

import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  calculateStateApportionment,
  apportionIncome,
  STATE_LAW_TODOS,
} from '../us/apportionment.js';

describe('calculateStateApportionment', () => {
  const valid = {
    stateCode: 'CA',
    payrollInState: '250',
    payrollTotal: '1000',
    propertyInState: '100',
    propertyTotal: '1000',
    salesInState: '500',
    salesTotal: '1000',
  };

  it('computes factors and a default one-third weighted fraction', () => {
    const r = calculateStateApportionment(valid);
    expect(r.status).toBe('ok');
    expect(r.payrollFactor!.toFixed(3)).toBe('0.250');
    expect(r.propertyFactor!.toFixed(3)).toBe('0.100');
    expect(r.salesFactor!.toFixed(3)).toBe('0.500');
    // (0.25 + 0.10 + 0.50) / 3
    expect(r.apportionmentFraction!.toFixed(6)).toBe('0.283333');
  });

  it('honors explicit weights', () => {
    const r = calculateStateApportionment({
      ...valid,
      weightPayroll: '0',
      weightProperty: '0',
      weightSales: '1',
    });
    expect(r.status).toBe('ok');
    expect(r.apportionmentFraction!.toFixed(3)).toBe('0.500');
  });

  it('reports no_activity when every total is zero', () => {
    const r = calculateStateApportionment({
      stateCode: 'NY',
      payrollInState: '0',
      payrollTotal: '0',
      propertyInState: '0',
      propertyTotal: '0',
      salesInState: '0',
      salesTotal: '0',
    });
    expect(r.status).toBe('no_activity');
    expect(r.apportionmentFraction).toBeNull();
  });

  it('rejects in-state amounts exceeding totals', () => {
    const r = calculateStateApportionment({ ...valid, salesInState: '1200', salesTotal: '1000' });
    expect(r.status).toBe('invalid_factors');
    expect(r.reason).toContain('sales');
  });

  it('rejects negative amounts', () => {
    const r = calculateStateApportionment({ ...valid, payrollInState: '-1' });
    expect(r.status).toBe('invalid_factors');
  });

  it('rejects weights that do not sum to one', () => {
    const r = calculateStateApportionment({
      ...valid,
      weightPayroll: '1',
      weightProperty: '1',
      weightSales: '1',
    });
    expect(r.status).toBe('invalid_weights');
  });

  it('accepts weights within tolerance of one', () => {
    const r = calculateStateApportionment({
      ...valid,
      weightPayroll: '0.33333333333',
      weightProperty: '0.33333333334',
      weightSales: '0.33333333333',
    });
    expect(r.status).toBe('ok');
  });

  it('does not invent state tax rates', () => {
    // The skeleton has no concept of a tax rate anywhere in its API.
    expect(STATE_LAW_TODOS.length).toBeGreaterThan(0);
    expect(STATE_LAW_TODOS.every((t) => t.startsWith('TODO:'))).toBe(true);
  });
});

describe('apportionIncome', () => {
  it('multiplies fraction by income', () => {
    const out = apportionIncome('0.3', '100000');
    expect(out).toBeInstanceOf(Decimal);
    expect(out.toFixed(2)).toBe('30000.00');
  });
});
