/**
 * Ground truth extractor — pulls a company's disclosed tax footnote
 * from XBRL company facts.
 *
 * What we extract (all from the latest annual 10-K period):
 * - Pretax book income
 * - Total / current / deferred income tax expense
 * - Every ETR reconciliation line item (IncomeTaxReconciliation* tags)
 *
 * This is audited, legally-filed data — the perfect answer key.
 */

export interface ReconItem {
  tag: string;
  label: string;
  amount: number;
  source: 'usd' | 'percent';
}

export interface TaxFootnote {
  entityName: string;
  fiscalYearEnd: string;
  pretaxIncome: number;
  totalTaxExpense: number;
  currentTaxExpense: number | null;
  deferredTaxExpense: number | null;
  disclosedETR: number;
  statutoryLine: number | null;
  reconItems: ReconItem[];
}

interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Pick the best annual value for a tag: latest fiscal-year 10-K entry
 * spanning roughly a full year. Dedupes amendments by latest filed date.
 */
function pickAnnual(units: Record<string, XbrlFact[]> | undefined): XbrlFact | null {
  const usd = units?.['USD'];
  if (!usd || usd.length === 0) return null;

  const annual = usd.filter(f => {
    if (f.form !== '10-K' || !f.start) return false;
    const days = (new Date(f.end).getTime() - new Date(f.start).getTime()) / MS_PER_DAY;
    return days >= 330 && days <= 400;
  });
  if (annual.length === 0) return null;

  annual.sort((a, b) =>
    b.end.localeCompare(a.end) || (b.filed ?? '').localeCompare(a.filed ?? ''),
  );
  return annual[0];
}

function getTag(taxonomy: any, tag: string): { fact: XbrlFact | null; label: string } {
  const entry = taxonomy?.[tag];
  return { fact: pickAnnual(entry?.units), label: entry?.label ?? tag };
}

export function extractTaxFootnote(companyFacts: any): TaxFootnote {
  // companyfacts payload: { cik, entityName, facts: { 'us-gaap': { [tag]: ... } } }
  const gaap = companyFacts?.facts?.['us-gaap'] ?? {};

  const pretax = getTag(gaap, 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest')
    .fact ?? getTag(gaap, 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments').fact;
  if (!pretax) throw new Error('No annual pretax income fact found');

  const totalTax = getTag(gaap, 'IncomeTaxExpenseBenefit').fact;
  if (!totalTax) throw new Error('No annual IncomeTaxExpenseBenefit fact found');

  const current = getTag(gaap, 'CurrentIncomeTaxExpenseBenefit').fact;
  const deferred = getTag(gaap, 'DeferredIncomeTaxExpenseBenefit').fact;
  const statutory = getTag(gaap, 'IncomeTaxReconciliationIncomeTaxExpenseBenefitAtFederalStatutoryIncomeTaxRate').fact;

  // Collect every ETR reconciliation line with an annual USD value,
  // excluding the statutory line itself (extracted above) and subtotals.
  const SKIP = new Set([
    'IncomeTaxReconciliationIncomeTaxExpenseBenefitAtFederalStatutoryIncomeTaxRate',
    'IncomeTaxReconciliationIncomeTaxExpenseBenefit',
    'IncomeTaxReconciliationEffectiveIncomeTaxRateContinuingOperations',
  ]);

  const reconItems: ReconItem[] = [];
  for (const [tag, entry] of Object.entries<any>(gaap)) {
    if (!tag.startsWith('IncomeTaxReconciliation') || SKIP.has(tag)) continue;
    const fact = pickAnnual(entry?.units);
    if (!fact) continue;
    if (fact.end !== totalTax.end) continue; // align to same fiscal year
    reconItems.push({ tag, label: entry?.label ?? tag, amount: fact.val });
  }

  return {
    entityName: companyFacts.entityName ?? 'Unknown',
    fiscalYearEnd: totalTax.end,
    pretaxIncome: pretax.val,
    totalTaxExpense: totalTax.val,
    currentTaxExpense: current?.val ?? null,
    deferredTaxExpense: deferred?.val ?? null,
    disclosedETR: totalTax.val / pretax.val,
    statutoryLine: statutory?.val ?? null,
    reconItems,
  };
}
