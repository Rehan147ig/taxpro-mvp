import { describe, it, expect } from 'vitest';
import { stableHash } from '../eve/hash.js';
import { canMutate, ensureTenantScoped } from '../lib/middleware/rbac.js';
import { assertNotLocked, transitionStage } from '../state/tax-provision-state.js';
import type { TaxProvisionState, PipelineStage } from '../state/tax-provision-state.js';
import { NotFoundError } from '../lib/errors.js';

describe('RBAC: canMutate', () => {

  it('preparer can mutate', () => {
    expect(canMutate('preparer')).toBe(true);
  });

  it('reviewer can mutate', () => {
    expect(canMutate('reviewer')).toBe(true);
  });

  it('partner can mutate', () => {
    expect(canMutate('partner')).toBe(true);
  });

  it('admin can mutate', () => {
    expect(canMutate('admin')).toBe(true);
  });

  it('client_readonly cannot mutate', () => {
    expect(canMutate('client_readonly')).toBe(false);
  });

  it('auditor cannot mutate', () => {
    expect(canMutate('auditor')).toBe(false);
  });

  it('unknown role returns true (safe default)', () => {
    expect(canMutate('unknown_role')).toBe(true);
  });

});

describe('RBAC: ensureTenantScoped', () => {

  it('does not throw when tenant matches', () => {
    expect(() => ensureTenantScoped('tenant-a', 'tenant-a')).not.toThrow();
  });

  it('throws NotFoundError when tenant mismatches', () => {
    expect(() => ensureTenantScoped('tenant-a', 'tenant-b')).toThrow(NotFoundError);
  });

  it('throws NotFoundError when resource has null tenant', () => {
    expect(() => ensureTenantScoped('tenant-a', null)).toThrow(NotFoundError);
  });

});

describe('stableHash: deterministic hash', () => {

  it('returns same hash for same input', () => {
    const input = { a: 1, b: 'hello', c: null, d: [1, 2, 3] };
    expect(stableHash(input)).toBe(stableHash(input));
  });

  it('returns same hash regardless of key order', () => {
    const a = stableHash({ x: 1, y: 2 });
    const b = stableHash({ y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it('returns different hash for different input', () => {
    const a = stableHash({ value: 'foo' });
    const b = stableHash({ value: 'bar' });
    expect(a).not.toBe(b);
  });

  it('handles string input', () => {
    const result = stableHash('hello');
    expect(result).toBeTypeOf('string');
    expect(result).toHaveLength(64); // SHA-256 hex
  });

  it('handles number input', () => {
    const result = stableHash(42);
    expect(result).toHaveLength(64);
  });

  it('handles null input', () => {
    expect(stableHash(null)).toHaveLength(64);
  });

  it('handles undefined input', () => {
    expect(stableHash(undefined)).toHaveLength(64);
  });

  it('handles nested arrays', () => {
    const a = stableHash([1, [2, 3]]);
    const b = stableHash([1, [2, 3]]);
    expect(a).toBe(b);
  });

});

describe('state machine: assertNotLocked', () => {

  const makeState = (overrides?: Partial<TaxProvisionState>): TaxProvisionState => ({
    jobId: 'test-123',
    jurisdiction: 'US_ASC740',
    stage: 'calculate',
    parsedItems: [],
    mappedItems: [],
    engineOutput: null,
    explanations: [],
    auditFlags: [],
    humanReview: 'pending',
    locked: false,
    ...overrides,
  });

  it('does not throw when not locked', () => {
    expect(() => assertNotLocked(makeState({ locked: false }))).not.toThrow();
  });

  it('throws when locked', () => {
    expect(() => assertNotLocked(makeState({ locked: true }))).toThrow('Provision is locked');
  });

});

describe('state machine: transitionStage', () => {

  const base: TaxProvisionState = {
    jobId: 'test-123',
    jurisdiction: 'US_ASC740',
    stage: 'calculate',
    parsedItems: [],
    mappedItems: [],
    engineOutput: null,
    explanations: [],
    auditFlags: [],
    humanReview: 'pending',
    locked: false,
  };

  it('transitions to allowed target stage', () => {
    const next = transitionStage(base, 'explain', ['calculate']);
    expect(next.stage).toBe('explain');
    expect(next).not.toBe(base); // immutable
  });

  it('throws when transitioning from disallowed stage', () => {
    expect(() => transitionStage(base, 'explain', ['parse']))
      .toThrow('Cannot transition');
  });

  it('throws when locked', () => {
    const locked = { ...base, locked: true };
    expect(() => transitionStage(locked, 'explain', ['calculate']))
      .toThrow('locked');
  });

  const VALID_SEQUENCES = ['parse', 'map', 'calculate', 'explain', 'audit', 'review', 'locked'];

  VALID_SEQUENCES.forEach((stage, i) => {
    if (i === 0) return;
    it(`can transition from ${VALID_SEQUENCES[i - 1]} to ${stage}`, () => {
      const state = { ...base, stage: VALID_SEQUENCES[i - 1] as PipelineStage };
      const next = transitionStage(state, stage as PipelineStage, [VALID_SEQUENCES[i - 1] as PipelineStage]);
      expect(next.stage).toBe(stage);
    });
  });

});
