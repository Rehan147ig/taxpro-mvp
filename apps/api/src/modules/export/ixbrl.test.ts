import { describe, expect, it } from 'vitest';
import { buildIxbrlInstance, buildInlineIxbrl, ixbrlFromProvisionDetail, FRS102_TAGS, FRS102_NS, IXBRL_NS, IX_NS } from './ixbrl.js';

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

function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const tagRe = /<\/?([\w-]+)(?:\s[^>]*)?\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const full = m[0];
    const name = m[1];
    if (full.endsWith('/>')) continue;
    if (full.startsWith('</')) {
      const open = stack.pop();
      if (open !== name) throw new Error(`Mismatched close tag </${name}> (expected </${open}>)`);
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) throw new Error(`Unclosed tags: ${stack.join(', ')}`);
}

describe('buildIxbrlInstance', () => {
  it('emits a well-formed instance with contexts, unit and tagged facts', () => {
    const doc = buildIxbrlInstance(INPUT);
    assertWellFormed(doc.content);
    expect(doc.content).toContain(`<xbrl xmlns="${IXBRL_NS}"`);
    expect(doc.content).toContain(`xmlns:ukgaap="${FRS102_NS}"`);
    expect(doc.content).toContain('<period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period>');
    expect(doc.content).toContain('<ukgaap:ProfitLossBeforeTax');
    expect(doc.content).toContain('>480000.00</ukgaap:ProfitLossBeforeTax>');
    expect(doc.content).toContain('>113000.00</ukgaap:CurrentTaxOnProfitOrLoss>');
    expect(doc.content).toContain('>7000.00</ukgaap:DeferredTaxOnProfitOrLoss>');
    expect(doc.facts).toHaveLength(6);
    expect(doc.facts[0]).toMatchObject({ tag: FRS102_TAGS.REVENUE, value: 1000000 });
  });

  it('skips zero facts', () => {
    const doc = buildIxbrlInstance({ ...INPUT, figures: { profitBeforeTax: 0, revenue: 0 } });
    expect(doc.facts).toHaveLength(0);
  });

  it('carries versioned taxonomy metadata and the validation-ready honesty contract', () => {
    const doc = buildIxbrlInstance(INPUT);
    expect(doc.readyStatus).toBe('validation_ready');
    expect(doc.schemaRef).toContain('ukgaap-frs102-2023-01-01.xsd');
    expect(doc.content).toContain(`schemaRef="${doc.schemaRef}"`);
    expect(doc.periodStart).toBe('2025-01-01');
    expect(doc.periodEnd).toBe('2025-12-31');
  });

  it('escapes XML-sensitive identifiers', () => {
    const doc = buildIxbrlInstance({ ...INPUT, companiesHouseNumber: 'A&B<Co>' });
    expect(doc.content).not.toContain('<Co>');
    expect(doc.content).toContain('A&amp;B&lt;Co&gt;');
  });

  it('renders numeric facts deterministically with fixed decimals (incl. negative values)', () => {
    const doc = buildIxbrlInstance({ ...INPUT, figures: { profitBeforeTax: -480000, taxOnProfitOrLoss: -120000.5 } });
    expect(doc.content).toContain('>-480000.00</ukgaap:ProfitLossBeforeTax>');
    expect(doc.content).toContain('>-120000.50</ukgaap:TaxOnProfitOrLoss>');
    expect(doc.facts).toHaveLength(2);
  });
});

describe('buildInlineIxbrl', () => {
  it('wraps facts in ix:nonFraction elements inside an ix:header', () => {
    const doc = buildInlineIxbrl(INPUT);
    assertWellFormed(doc.content);
    expect(doc.format).toBe('inline');
    expect(doc.content).toContain(`xmlns:ix="${IX_NS}"`);
    expect(doc.content).toContain('<ix:header>');
    expect(doc.content).toContain('<ix:context');
    expect(doc.content).toContain('<ix:nonFraction name="ukgaap:Revenue"');
    expect(doc.content).toContain('ixt:numdotdecimal');
  });

  it('escapes company name and CH number in the inline document', () => {
    const doc = buildInlineIxbrl({ ...INPUT, companyName: 'D&B "Sons" <Holdings> & Co', companiesHouseNumber: 'A&B<Co>' });
    assertWellFormed(doc.content);
    expect(doc.content).toContain('D&amp;B &quot;Sons&quot; &lt;Holdings&gt; &amp; Co');
    expect(doc.content).toContain('A&amp;B&lt;Co&gt;');
  });

  it('carries the validation-ready honesty contract', () => {
    const doc = buildInlineIxbrl(INPUT);
    expect(doc.readyStatus).toBe('validation_ready');
    expect(doc.schemaRef).toContain('ukgaap-frs102-2023-01-01.xsd');
    expect(doc.content).toContain('validated against the Companies House iXBRL validation service before filing');
  });
});

describe('ixbrlFromProvisionDetail', () => {
  it('maps a provision detail into figures', () => {
    const doc = ixbrlFromProvisionDetail(
      { companyName: 'X', companiesHouseNumber: '1', periodStart: '2025-01-01', periodEnd: '2025-12-31', currency: 'GBP' },
      { currentTax: { bookIncome: 125000, totalTaxAfterCredits: 29375 }, summary: { totalTaxExpense: 29375 } },
    );
    expect(doc.content).toContain('>125000.00</ukgaap:ProfitLossBeforeTax>');
    expect(doc.content).toContain('>29375.00</ukgaap:CurrentTaxOnProfitOrLoss>');
  });
});
