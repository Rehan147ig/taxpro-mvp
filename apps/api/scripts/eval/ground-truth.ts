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
    // New-taxonomy (2024+ US-GAAP) equivalents of the above — subtotals.
    'EffectiveIncomeTaxRateReconciliationIncomeTaxExpenseBenefitAtFederalStatutoryIncomeTaxRate',
    'EffectiveIncomeTaxRateReconciliationIncomeTaxExpenseBenefit',
    'EffectiveIncomeTaxRateReconciliationEffectiveIncomeTaxRateContinuingOperations',
    // Percent-form statutory rate line (units.pure) — the statutory line,
    // not a recon item. Picked up by the percent fallback if not excluded.
    'EffectiveIncomeTaxRateReconciliationAtFederalStatutoryIncomeTaxRate',
    'EffectiveIncomeTaxRateReconciliationAtFederalStatutoryIncomeTaxRatePercent',
  ]);

  /**
   * A tag is a collectable ETR recon line if it is:
   *  - a legacy `IncomeTaxReconciliation*` dollar tag, or
   *  - a new-taxonomy `EffectiveIncomeTaxRateReconciliation*` tag, EXCLUDING
   *    the `...Percent` variants (percentage-only — no dollar impact) and the
   *    subtotals. The 2024+ US-GAAP taxonomy moved recon dollars under this
   *    namespace; both suffixed (`...Amount`) and unsuffixed dollar forms exist.
   */
  const isReconLine = (tag: string): boolean => {
    if (SKIP.has(tag)) return false;
    if (tag.startsWith('IncomeTaxReconciliation')) return true;
    if (tag.startsWith('EffectiveIncomeTaxRateReconciliation')) {
      return !tag.endsWith('Percent');
    }
    return false;
  };

  const reconItems: ReconItem[] = [];
  const seen = new Set<string>();
  for (const [tag, entry] of Object.entries<any>(gaap)) {
    if (!isReconLine(tag)) continue;
    const fact = pickAnnual(entry?.units);
    if (!fact) continue;
    if (fact.end !== totalTax.end) continue; // align to same fiscal year
    // Dedupe: if the legacy tag and new-taxonomy tag describe the same line
    // (same suffix after the namespace prefix), keep the one that tied best
    // by keeping the legacy entry (filer convention consistency).
    const suffix = tag.replace(/^EffectiveIncomeTaxRateReconciliation/, 'IncomeTaxReconciliation');
    if (seen.has(suffix)) continue;
    seen.add(suffix);
    reconItems.push({ tag, label: entry?.label ?? tag, amount: fact.val, source: 'usd' });
  }

  // P2 percent-path fallback: some filers (e.g. CLX) disclose their annual
  // ETR recon in percentage form only (units.pure), with no USD amounts.
  // When NO USD recon items exist, read the percentage items aligned to the
  // fiscal year and convert to dollar impacts (percent × pretax income).
  // The mapper still applies the tie gate, so percent-derived items only
  // count as validated when they internally reconcile to the disclosed ETR.
  //
  // NOTE: filers are inconsistent — some tag pure-unit values under a
  // `*Percent` tag, others under the plain tag (same name as the USD form).
  // So this fallback scans any `EffectiveIncomeTaxRateReconciliation*` tag
  // whose annual value lives in units.pure, excluding the SKIP subtotals.
  if (reconItems.length === 0) {
    for (const [tag, entry] of Object.entries<any>(gaap)) {
      if (!tag.startsWith('EffectiveIncomeTaxRateReconciliation')) continue;
      if (SKIP.has(tag)) continue;
      const pure = entry?.units?.pure;
      if (!pure || pure.length === 0) continue;
      const annual = pure.filter(f => f.form === '10-K' && f.start);
      if (annual.length === 0) continue;
      annual.sort((a, b) => b.end.localeCompare(a.end) || (b.filed ?? '').localeCompare(a.filed ?? ''));
      const fact = annual[0];
      if (fact.end !== totalTax.end) continue; // align to same fiscal year
      const suffix = tag.replace(/^EffectiveIncomeTaxRateReconciliation/, '').replace(/Percent$/, '');
      if (seen.has(suffix)) continue;
      seen.add(suffix);
      // percent × pretax income → dollar tax impact (source: percent flags it)
      reconItems.push({ tag, label: entry?.label ?? tag, amount: fact.val * pretax.val, source: 'percent' });
    }
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
