import { toNumber } from './ct600.js';

/**
 * iXBRL accounts generator (UK FRS 102 / Companies House filing).
 *
 * Produces:
 *  1. A standalone XBRL instance document (well-formed XML) tagging the
 *     accounts line items that drive the tax note — Revenue, PBT, tax
 *     on profit/loss, current/deferred split.
 *  2. An inline XBRL (iXBRL) HTML wrapper embedding the tagged facts, which
 *     is the format Companies House accepts for full/abridged accounts.
 *
 * The tag names follow the FRS 102 (UK GAAP) taxonomy naming. HONESTY NOTE:
 * final tagging must be validated against the Companies House iXBRL validation
 * service and the current taxonomy release — this generator produces the
 * structure and figures, not a guaranteed-filing-ready document.
 */

export const IXBRL_NS = 'http://www.xbrl.org/2003/instance';
export const IX_NS = 'http://www.xbrl.org/2008/inlineXBRL';
export const FRS102_NS = 'http://www.hmrc.gov.uk/ukgaap/frs102/taxonomy';

export const FRS102_TAGS = {
  REVENUE: 'Revenue',
  PROFIT_LOSS_BEFORE_TAX: 'ProfitLossBeforeTax',
  TAX_ON_PROFIT_LOSS: 'TaxOnProfitOrLoss',
  CURRENT_TAX_ON_PROFIT_LOSS: 'CurrentTaxOnProfitOrLoss',
  DEFERRED_TAX_ON_PROFIT_LOSS: 'DeferredTaxOnProfitOrLoss',
  PROFIT_LOSS_AFTER_TAX: 'ProfitLossAfterTax',
} as const;

export interface IxbrlInput {
  companyName: string;
  companiesHouseNumber: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  figures: {
    revenue?: number;
    profitBeforeTax?: number;
    taxOnProfitOrLoss?: number;
    currentTax?: number;
    deferredTax?: number;
    profitAfterTax?: number;
  };
}

export interface IxbrlDocument {
  format: 'instance' | 'inline';
  periodStart: string;
  periodEnd: string;
  facts: Array<{ tag: string; value: number; context: string; unit: string }>;
  content: string;
  /** Honesty contract: structure/figures are validation-ready, NOT filing-ready until a real validator + taxonomy version lock. */
  readyStatus: 'validation_ready';
  /** Versioned UK GAAP taxonomy schema the instance is built against. */
  schemaRef: string;
}

const ISO_ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (s: string) => s.replace(ISO_ESCAPE_RE, ch => ESCAPE_MAP[ch]);

function contextId(start: string, end: string) {
  return `CY-${start}_${end}`;
}

export function buildIxbrlInstance(input: IxbrlInput): IxbrlDocument {
  const facts = collectFacts(input);
  const ctx = contextId(input.periodStart, input.periodEnd);
  const unit = input.currency;

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<xbrl xmlns="${IXBRL_NS}" xmlns:ukgaap="${FRS102_NS}" xmlns:link="${'http://www.xbrl.org/2003/linkbase'}" xmlns:xl="${'http://www.xbrl.org/2003/xlink'}" xmlns:iso4217="${'http://www.xbrl.org/2003/iso4217'}" schemaRef="${FRS102_NS}/ukgaap-frs102-2023-01-01.xsd">`);
  lines.push(`  <context id="${ctx}">`);
  lines.push(`    <entity><identifier scheme="${'http://www.companieshouse.gov.uk/'}">${esc(input.companiesHouseNumber)}</identifier></entity>`);
  lines.push(`    <period><startDate>${input.periodStart}</startDate><endDate>${input.periodEnd}</endDate></period>`);
  lines.push(`  </context>`);
  lines.push(`  <unit id="GBP"><measure>iso4217:${unit}</measure></unit>`);
  for (const f of facts) {
    lines.push(`  <ukgaap:${f.tag} contextRef="${ctx}" unitRef="GBP" decimals="2" scale="0">${f.value.toFixed(2)}</ukgaap:${f.tag}>`);
  }
  lines.push(`</xbrl>`);

  return { format: 'instance', periodStart: input.periodStart, periodEnd: input.periodEnd, facts, content: lines.join('\n'), readyStatus: 'validation_ready', schemaRef: `${FRS102_NS}/ukgaap-frs102-2023-01-01.xsd` };
}

export function buildInlineIxbrl(input: IxbrlInput): IxbrlDocument {
  const instance = buildIxbrlInstance(input);
  const ctx = contextId(input.periodStart, input.periodEnd);

  const html = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<html xmlns="${'http://www.w3.org/1999/xhtml'}" xmlns:ix="${IX_NS}" xmlns:ukgaap="${FRS102_NS}">`,
    `  <head><title>${esc(input.companyName)} — iXBRL accounts</title></head>`,
    `  <body>`,
    `    <ix:header>`,
    `      <ix:resources>`,
    `        <ix:context id="${ctx}">`,
    `          <ix:entity><ix:identifier scheme="${'http://www.companieshouse.gov.uk/'}">${esc(input.companiesHouseNumber)}</ix:identifier></ix:entity>`,
    `          <ix:period><ix:start>${input.periodStart}</ix:start><ix:end>${input.periodEnd}</ix:end></ix:period>`,
    `        </ix:context>`,
    `        <ix:unit id="GBP"><ix:measure>iso4217:${input.currency}</ix:measure></ix:unit>`,
    `      </ix:resources>`,
    `    </ix:header>`,
    `    <h1>${esc(input.companyName)} — Financial statements (FRS 102)</h1>`,
    `    <table border="1">`,
    `      <tr><th>Line item</th><th>Amount (${input.currency})</th></tr>`,
    ...instance.facts.map(f =>
      `      <tr><td>${f.tag}</td><td><ix:nonFraction name="ukgaap:${f.tag}" contextRef="${ctx}" unitRef="GBP" decimals="2" format="ixt:numdotdecimal">${f.value.toFixed(2)}</ix:nonFraction></td></tr>`),
    `    </table>`,
    `    <p><i>Generated by TaxPro. Tagging must be validated against the Companies House iXBRL validation service before filing.</i></p>`,
    `  </body>`,
    `</html>`,
  ];

  return { ...instance, format: 'inline', content: html.join('\n') };
}

export function ixbrlFromProvisionDetail(
  input: Omit<IxbrlInput, 'figures'> & { figures?: Partial<IxbrlInput['figures']> },
  detail: { currentTax?: Record<string, unknown>; summary?: { totalTaxExpense?: number } } | null,
): IxbrlDocument {
  const ct = (detail?.currentTax ?? {}) as Record<string, any>;
  const figures = {
    revenue: toNumber(input.figures?.revenue ?? 0),
    profitBeforeTax: toNumber(input.figures?.profitBeforeTax ?? ct.bookIncome ?? 0),
    taxOnProfitOrLoss: toNumber(input.figures?.taxOnProfitOrLoss ?? detail?.summary?.totalTaxExpense ?? 0),
    currentTax: toNumber(input.figures?.currentTax ?? ct.totalTaxAfterCredits ?? ct.federalTax ?? 0),
    deferredTax: toNumber(input.figures?.deferredTax ?? ct.deferredTaxExpense ?? 0),
    profitAfterTax: toNumber(input.figures?.profitAfterTax ?? 0),
  };
  return buildIxbrlInstance({ ...input, figures });
}

function collectFacts(input: IxbrlInput) {
  const ctx = contextId(input.periodStart, input.periodEnd);
  const facts: Array<{ tag: string; value: number; context: string; unit: string }> = [];
  const push = (tag: string, value: number | undefined) => {
    const n = toNumber(value);
    if (n !== 0) facts.push({ tag, value: n, context: ctx, unit: 'GBP' });
  };
  push(FRS102_TAGS.REVENUE, input.figures.revenue);
  push(FRS102_TAGS.PROFIT_LOSS_BEFORE_TAX, input.figures.profitBeforeTax);
  push(FRS102_TAGS.TAX_ON_PROFIT_LOSS, input.figures.taxOnProfitOrLoss);
  push(FRS102_TAGS.CURRENT_TAX_ON_PROFIT_LOSS, input.figures.currentTax);
  push(FRS102_TAGS.DEFERRED_TAX_ON_PROFIT_LOSS, input.figures.deferredTax);
  push(FRS102_TAGS.PROFIT_LOSS_AFTER_TAX, input.figures.profitAfterTax);
  return facts;
}
