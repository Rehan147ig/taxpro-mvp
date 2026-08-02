// Tests for the UK group relief calculator.
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.

import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { calculateGroupRelief, GROUP_RELIEF_UNHANDLED_GAPS } from '../uk/group-relief.js';

describe('calculateGroupRelief', () => {
  it('surrenders a loss to a claimant and records the elimination trail', () => {
    const result = calculateGroupRelief([
      { entityId: 'parent', taxableProfit: '100000.00' },
      { entityId: 'sub', taxableProfit: '-40000.00' },
    ]);

    expect(result.totalLossesSurrendered.toFixed(2)).toBe('40000.00');
    expect(result.totalReliefUtilised.toFixed(2)).toBe('40000.00');
    expect(result.steps).toHaveLength(1);
    const step = result.steps[0];
    expect(step.fromEntityId).toBe('sub');
    expect(step.toEntityId).toBe('parent');
    expect(step.surrendered.toFixed(2)).toBe('40000.00');
    expect(step.remainingClaimantProfit.toFixed(2)).toBe('60000.00');
    expect(step.remainingSurrendererLoss.toFixed(2)).toBe('0.00');

    const [parent, sub] = result.entities;
    expect(parent.status).toBe('claimant');
    expect(parent.reliefReceived.toFixed(2)).toBe('40000.00');
    expect(sub.status).toBe('surrenderer');
    expect(sub.remainingLoss.toFixed(2)).toBe('0.00');
  });

  it('caps relief at the claimant taxable profit (statutory cap assumption)', () => {
    const result = calculateGroupRelief([
      { entityId: 'a', taxableProfit: '5000.00' },
      { entityId: 'b', taxableProfit: '-20000.00' },
    ]);

    expect(result.totalReliefUtilised.toFixed(2)).toBe('5000.00');
    expect(result.steps[0].reason).toBe('claimant_capped');
    const a = result.entities.find((e) => e.entityId === 'a')!;
    const b = result.entities.find((e) => e.entityId === 'b')!;
    expect(a.remainingProfit.toFixed(2)).toBe('0.00');
    expect(b.remainingLoss.toFixed(2)).toBe('15000.00');
  });

  it('processes multiple claimants in input order deterministically', () => {
    const result = calculateGroupRelief([
      { entityId: 'c1', taxableProfit: '1000' },
      { entityId: 'c2', taxableProfit: '1000' },
      { entityId: 's1', taxableProfit: '-1500' },
    ]);

    expect(result.totalReliefUtilised.toFixed(2)).toBe('1500.00');
    expect(result.steps.map((s) => s.toEntityId)).toEqual(['c1', 'c2']);
    expect(result.steps[0].reason).toBe('claimant_capped');
    expect(result.steps[1].reason).toBe('full');
    const c2 = result.entities.find((e) => e.entityId === 'c2')!;
    expect(c2.reliefReceived.toFixed(2)).toBe('500.00');
    const s1 = result.entities.find((e) => e.entityId === 's1')!;
    expect(s1.remainingLoss.toFixed(2)).toBe('0.00');
  });

  it('leaves an excess loss unconsumed when no claimant remains', () => {
    const result = calculateGroupRelief([
      { entityId: 'c1', taxableProfit: '1000' },
      { entityId: 's1', taxableProfit: '-3000' },
      { entityId: 's2', taxableProfit: '-500' },
    ]);

    expect(result.totalReliefUtilised.toFixed(2)).toBe('1000.00');
    const s2 = result.entities.find((e) => e.entityId === 's2')!;
    expect(s2.reliefSurrendered.toFixed(2)).toBe('0.00');
    expect(s2.remainingLoss.toFixed(2)).toBe('500.00');
    expect(result.steps).toHaveLength(1);
  });

  it('returns empty steps and zero totals when nobody claims or surrenders', () => {
    const result = calculateGroupRelief([
      { entityId: 'a', taxableProfit: '0' },
      { entityId: 'b', taxableProfit: '100' },
    ]);

    expect(result.steps).toHaveLength(0);
    expect(result.totalReliefUtilised.toFixed(2)).toBe('0.00');
    expect(result.entities.every((e) => e.reliefReceived.isZero() && e.reliefSurrendered.isZero())).toBe(true);
  });

  it('uses Decimal semantics throughout', () => {
    const result = calculateGroupRelief([{ entityId: 'a', taxableProfit: '1.005' }]);
    expect(result.entities[0].taxableProfit).toBeInstanceOf(Decimal);
    expect(result.entities[0].taxableProfit.toFixed(2)).toBe('1.01');
  });

  it('rounds fractional input to 2dp before computing', () => {
    const result = calculateGroupRelief([
      { entityId: 'a', taxableProfit: '10.004' },
      { entityId: 'b', taxableProfit: '-3.333' },
    ]);
    expect(result.steps[0].surrendered.toFixed(2)).toBe('3.33');
  });

  it('reports every unhandled gap identifier', () => {
    const result = calculateGroupRelief([]);
    expect(result.unhandledGaps).toEqual([...GROUP_RELIEF_UNHANDLED_GAPS]);
    expect(result.unhandledGaps).toContain('consortium_relief');
    expect(result.unhandledGaps).toContain('non_coterminous_periods');
    expect(result.unhandledGaps).toContain('carried_forward_losses');
  });

  it('passes the period through from options', () => {
    const result = calculateGroupRelief([], { period: 'FY2025' });
    expect(result.period).toBe('FY2025');
  });
});
