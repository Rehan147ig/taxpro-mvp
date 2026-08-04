import { describe, it, expect } from 'vitest';
import { validateUkClassification, UK_FRS102_CLASSIFICATIONS } from '../modules/mapping/uk-taxonomy.js';

describe('Phase B — UK FRS 102 mapping taxonomy (controlled, fail-open to manual review)', () => {

  it('exposes a controlled classification list', () => {
    expect(Array.isArray(UK_FRS102_CLASSIFICATIONS)).toBe(true);
    expect(UK_FRS102_CLASSIFICATIONS.length).toBeGreaterThan(0);
    expect(UK_FRS102_CLASSIFICATIONS).toEqual([...new Set(UK_FRS102_CLASSIFICATIONS)]);
  });

  it('keeps permanent and temporary categories distinct', () => {
    const perms = UK_FRS102_CLASSIFICATIONS.filter((c) => c.startsWith('PERM_'));
    const temps = UK_FRS102_CLASSIFICATIONS.filter((c) => c.startsWith('TEMP_'));
    const noDiffs = UK_FRS102_CLASSIFICATIONS.filter((c) => c.startsWith('NODIFF_'));
    expect(perms.length).toBeGreaterThan(0);
    expect(temps.length).toBeGreaterThan(0);
    expect(noDiffs.length).toBeGreaterThan(0);
  });

  it('passes through known classifications unchanged', () => {
    expect(validateUkClassification('NODIFF_REVENUE')).toBe('NODIFF_REVENUE');
    expect(validateUkClassification('PERM_MEALS_ENTERTAINMENT')).toBe('PERM_MEALS_ENTERTAINMENT');
    expect(validateUkClassification('TEMP_DEPRECIATION')).toBe('TEMP_DEPRECIATION');
  });

  it('maps an unsupported classification to MANUAL_REVIEW instead of failing', () => {
    expect(validateUkClassification('SOME_RANDOM_TAX_CODE')).toBe('MANUAL_REVIEW');
  });

  it('maps an empty or malformed classification to MANUAL_REVIEW', () => {
    expect(validateUkClassification('')).toBe('MANUAL_REVIEW');
    expect(validateUkClassification('   ')).toBe('MANUAL_REVIEW');
    expect(validateUkClassification('!@#$%')).toBe('MANUAL_REVIEW');
  });
});
