// Tests for the Rule Update Agent (extraction half of the rule-refresh loop).

import { describe, it, expect, vi } from 'vitest';
import { runRuleUpdateAgent } from '../agent/subagents/rule-update-agent.js';

const { __modelState } = vi.hoisted(() => {
  const state: { mode: 'valid' | 'fail' | 'invalid' } = { mode: 'valid' };
  return { __modelState: state };
});

vi.mock('../eve/model-client.js', () => ({
  callJsonModel: async ({ promptVersion }: { promptVersion?: string }) => {
    if (__modelState.mode === 'fail') {
      throw new Error('mock model failure');
    }
    if (String(promptVersion).startsWith('rule-update')) {
      if (__modelState.mode === 'invalid') {
        return {
          parsed: {
            stateCode: 'NE',
            taxYear: 2027,
            filingType: 'cit',
            schedule: { kind: 'flat', rate: 0.5 },
            source: { name: 'mock', url: 'https://mock', publishedAt: '2026-01-01' },
            excerpt: 'Neb. Rev. Stat. §77-2734.04: 3.99% effective January 1, 2027.',
            confidence: 0.9,
            reasoning: 'mock',
          },
          raw: '{}',
          provider: 'mock',
          model: 'mock',
        };
      }
      return {
        parsed: {
          stateCode: 'NE',
          taxYear: 2027,
          filingType: 'cit',
          schedule: { kind: 'flat', rate: 0.0399 },
          apportionmentWeights: { payroll: 0, property: 0, sales: 1 },
          source: { name: 'mock', url: 'https://mock', publishedAt: '2026-01-01' },
          excerpt: 'Neb. Rev. Stat. §77-2734.04: the corporate income tax rate shall be 3.99% for tax years beginning on or after January 1, 2027.',
          confidence: 0.95,
          reasoning: 'Statute sets the rate at 3.99% effective 2027.',
        },
        raw: '{}',
        provider: 'mock',
        model: 'mock',
      };
    }
    throw new Error('unexpected promptVersion');
  },
}));

const input = {
  tenantId: 't1',
  sourceText: 'Neb. Rev. Stat. §77-2734.04: the corporate income tax rate shall be 3.99% for tax years beginning on or after January 1, 2027.',
  sourceName: 'Nebraska Revenue',
  sourceUrl: 'https://revenue.nebraska.gov/',
  publishedAt: '2026-01-01',
  taxYear: 2027,
};

describe('runRuleUpdateAgent', () => {
  it('extracts a validated proposal and diffs it against the current ruleset', async () => {
    __modelState.mode = 'valid';
    const r = await runRuleUpdateAgent(input);

    expect(r.success).toBe(true);
    expect(r.validation.valid).toBe(true);
    expect(r.proposal).not.toBeNull();
    expect(r.proposal!.stateCode).toBe('NE');
    expect(r.proposal!.schedule.rate).toBe(0.0399);
    // Provenance is forced from the input, never invented by the model.
    expect(r.proposal!.source.url).toBe('https://revenue.nebraska.gov/');
    // The diff must show the rate change vs the 2026 ruleset (4.55% → 3.99%).
    expect(r.diff).not.toBeNull();
    expect(r.diff!.breaking).toBe(true);
    expect(r.diff!.changes.join(' | ')).toMatch(/4\.5500% → 3\.9900%/);
  });

  it('surfaces deterministic validation failures instead of accepting bad output', async () => {
    __modelState.mode = 'invalid';
    const r = await runRuleUpdateAgent(input);

    expect(r.success).toBe(false);
    expect(r.validation.valid).toBe(false);
    expect(r.validation.issues.some(i => /schedule\.rate/.test(i))).toBe(true);
    expect(r.error).toMatch(/validation/);
  });

  it('fails loudly when the model call fails', async () => {
    __modelState.mode = 'fail';
    const r = await runRuleUpdateAgent(input);

    expect(r.success).toBe(false);
    expect(r.proposal).toBeNull();
    expect(r.error).toBe('mock model failure');
  });
});
