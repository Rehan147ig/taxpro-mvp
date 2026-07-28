/**
 * UK FRS 102 fixture → tax-engine input mapper.
 *
 * Reconciliation items from filed statutory accounts are classified into
 * permanent, timing, and other categories, then fed through calculateETR
 * and calculateUkDeferredTax with jurisdiction UK_FRS102_S29.
 *
 * Sign convention: UK statutory accounts typically present ETR reconciliation
 * items as £-amount tax impacts. Credits reduce the total — we normalise
 * credit amounts to positive and let the engine negate them.
 */

import Decimal from 'decimal.js';
import { calculateETR, calculateUkDeferredTax } from '@taxpro/tax-engine';
import type { ETRResult, DeferredTaxResult, BookTaxDifference } from '@taxpro/tax-engine';
import type { UkTaxFootnote, UkReconItem } from './uk-ground-truth.js';

const UK_CORP_RATE = new Decimal('0.25');

export interface UkEngineRun {
  etr: ETRResult;
  deferred: DeferredTaxResult;
  classified: { permanent: UkReconItem[]; timing: UkReconItem[]; other: UkReconItem[] };
  deferredSource?: 'recon_timing' | 'balance_sheet_fallback';
}

function classify(items: UkReconItem[]) {
  const classified = { permanent: [] as UkReconItem[], timing: [] as UkReconItem[], other: [] as UkReconItem[] };
  for (const item of items) {
    if (item.type === 'permanent') classified.permanent.push(item);
    else if (item.type === 'timing') classified.timing.push(item);
    else classified.other.push(item);
  }
  return classified;
}

export function runEngine(footnote: UkTaxFootnote): UkEngineRun {
  const classified = classify(footnote.reconciliationItems);

  const permanentDifferences = classified.permanent.map(item => ({
    label: item.label,
    amount: new Decimal(item.amount).div(UK_CORP_RATE),
  }));

  const otherAdjustments = [...classified.timing, ...classified.other].map(item => ({
    label: item.label,
    amount: new Decimal(item.amount),
  }));

  const bookIncome = new Decimal(footnote.pretaxProfit);
  const federalTax = bookIncome.mul(UK_CORP_RATE);

  const etr = calculateETR({
    bookIncome,
    federalTaxRate: UK_CORP_RATE,
    federalTax,
    stateTax: new Decimal(0),
    permanentDifferences,
    taxCredits: new Decimal(0),
    otherAdjustments,
  });

  // Deferred tax: two paths —
  //   1. recon_timing:  ETR reconciliation includes timing items → feed through
  //                      calculateUkDeferredTax for full engine validation.
  //   2. balance_sheet_fallback:  No ETR timing items; derive directly from the
  //                      disclosed balance-sheet deferred tax balances (Note 14).
  //                      No synthetic temporary differences are fabricated.
  const hasTimingItems = classified.timing.length > 0;

  let deferred: DeferredTaxResult;
  let deferredSource: 'recon_timing' | 'balance_sheet_fallback';

  if (hasTimingItems) {
    deferredSource = 'recon_timing';
    const temporaryDifferences: BookTaxDifference[] = classified.timing.map((item, i) => ({
      accountId: `fixture-timing-${i}`,
      entityId: 'uk-eval-entity',
      period: footnote.accountingPeriodEnd,
      bookBalance: new Decimal(0),
      taxBalance: new Decimal(0),
      difference: new Decimal(item.amount),
      diffType: 'temporary',
      timingCategory: item.amount < 0 ? 'deductible_temporary' : 'taxable_temporary',
    }));

    const probableRecoveryMap: Record<string, boolean> = {};
    for (const item of classified.timing) {
      if (item.amount < 0) {
        const cat = 'deductible_temporary';
        probableRecoveryMap[cat] = footnote.probableRecoveryNoted;
      }
    }

    deferred = calculateUkDeferredTax(
      temporaryDifferences,
      {},
      {},
      {},
      probableRecoveryMap,
      footnote.accountingPeriodEnd,
    );
  } else if (footnote.deferredTaxBalanceSource === 'balance_sheet_fallback') {
    deferredSource = 'balance_sheet_fallback';
    deferred = {
      lines: [],
      totalOpeningDTA: new Decimal(0),
      totalOpeningDTL: new Decimal(0),
      totalClosingDTA: new Decimal(footnote.deferredTaxAssetClosing),
      totalClosingDTL: new Decimal(footnote.deferredTaxLiabilityClosing),
      netDeferredTaxExpense: new Decimal(footnote.deferredTaxCharge),
    };
  } else {
    // No timing items and no fallback → empty result (fixture not populated yet)
    deferredSource = 'recon_timing';
    deferred = calculateUkDeferredTax([], {}, {}, {}, {}, footnote.accountingPeriodEnd);
  }

  return { etr, deferred, classified, deferredSource };
}
