import { describe, expect, it } from 'vitest';
import { buildIxbrlInstance, buildInlineIxbrl } from './ixbrl.js';
import { validateIxbrlDocument, FRS102_SCHEMA_LOCK } from './ixbrl-validation.js';

const INPUT = {
  companyName: 'Greggs plc (Demo)',
  companiesHouseNumber: '00502851',
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  currency: 'GBP',
  figures: {
    revenue: 1_000_000,
    profitBeforeTax: 480000,
    taxOnProfitOrLoss: 120000,
    currentTax: 113000,
    deferredTax: 7000,
    profitAfterTax: 360000,
  },
};

describe('validateIxbrlDocument — structural conformance', () => {
  it('passes a generated instance document', () => {
    const doc = buildIxbrlInstance(INPUT);
    expect(doc.validation.valid).toBe(true);
    expect(doc.validation.violations).toHaveLength(0);
  });

  it('passes a generated inline document', () => {
    const doc = buildInlineIxbrl(INPUT);
    expect(doc.validation.valid).toBe(true);
    expect(doc.validation.checksRun).toBeGreaterThan(0);
  });

  it('fails when a referenced context is removed', () => {
    const doc = buildIxbrlInstance(INPUT);
    const content = doc.content.replace(/<context id="[^"]+">[\s\S]*?<\/context>/, '');
    const res = validateIxbrlDocument({ ...doc, content });
    expect(res.valid).toBe(false);
    expect(res.violations.some(v => v.includes('no contexts defined'))).toBe(true);
    expect(res.violations.some(v => v.includes("undefined context '"))).toBe(true);
  });

  it('fails when the schemaRef does not lock the taxonomy version', () => {
    const doc = buildIxbrlInstance(INPUT);
    const res = validateIxbrlDocument({
      ...doc,
      content: doc.content.replace(FRS102_SCHEMA_LOCK, 'ukgaap-frs102-2024-01-01.xsd'),
    });
    expect(res.valid).toBe(false);
    expect(res.violations.some(v => v.includes('schemaRef'))).toBe(true);
  });

  it('fails when a fact loses its decimals attribute', () => {
    const doc = buildIxbrlInstance(INPUT);
    const res = validateIxbrlDocument({
      ...doc,
      content: doc.content.replace(/decimals="2"/, ''),
    });
    expect(res.valid).toBe(false);
    expect(res.violations.some(v => v.includes('decimals="2"'))).toBe(true);
  });

  it('fails when a fact value is not a 2-decimal finite number', () => {
    const doc = buildIxbrlInstance(INPUT);
    const res = validateIxbrlDocument({
      ...doc,
      content: doc.content.replace('480000.00', '480000'),
    });
    expect(res.valid).toBe(false);
    expect(res.violations.some(v => v.includes('2 decimal places'))).toBe(true);
  });

  it('fails when document period metadata is not ISO', () => {
    const doc = buildIxbrlInstance(INPUT);
    const res = validateIxbrlDocument({ ...doc, periodStart: '2025/01/01' });
    expect(res.valid).toBe(false);
    expect(res.violations.some(v => v.includes('ISO dates'))).toBe(true);
  });

  it('fails when the context period disagrees with the document period', () => {
    const doc = buildIxbrlInstance(INPUT);
    const res = validateIxbrlDocument({
      ...doc,
      content: doc.content.replace('<startDate>2025-01-01</startDate>', '<startDate>2024-01-01</startDate>'),
    });
    expect(res.valid).toBe(false);
    expect(res.violations.some(v => v.includes('must match the document period'))).toBe(true);
  });

  it('fails when the company identifier is missing', () => {
    const doc = buildIxbrlInstance(INPUT);
    const res = validateIxbrlDocument({
      ...doc,
      content: doc.content.replace('scheme="http://www.companieshouse.gov.uk/"', 'scheme="http://example.com/"'),
    });
    expect(res.valid).toBe(false);
    expect(res.violations.some(v => v.includes('identifier'))).toBe(true);
  });
});
