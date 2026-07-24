import Decimal from 'decimal.js';
import {
  calculateCurrentTax,
  calculateDeferredTax,
  calculateETR,
  generateJournalEntries,
  generateRollforward,
} from '@taxpro/tax-engine';

export interface ProvisionMathInput {
  bookIncome: number;
  permanentDifferences: { amount: number; label: string }[];
  temporaryDifferences: {
    accountId: string;
    entityId: string;
    period: string;
    bookBalance: number;
    taxBalance: number;
    difference: number;
    diffType: 'temporary';
    timingCategory?: string;
  }[];
  federalRate: number;
  stateRate?: number;
  taxCredits?: number;
  estimatedPayments?: number;
  nolUtilization?: number;
  entityId: string;
  period: string;
}

export function runProvisionMath(input: ProvisionMathInput) {
  const bookIncome = money(input.bookIncome);
  const federalRate = rate(input.federalRate);
  const stateRate = input.stateRate && input.stateRate > 0 ? rate(input.stateRate) : undefined;

  const permanentDifferences = input.permanentDifferences.map((pd) => ({
    amount: money(pd.amount),
    label: pd.label,
  }));

  const temporaryDifferences = input.temporaryDifferences.map((d) => ({
    accountId: d.accountId,
    entityId: d.entityId,
    period: d.period,
    bookBalance: money(d.bookBalance),
    taxBalance: money(d.taxBalance),
    difference: money(d.difference),
    diffType: 'temporary' as const,
    timingCategory: d.timingCategory ?? 'TEMP_OTHER',
  }));

  const currentTax = calculateCurrentTax({
    bookIncome,
    permanentDifferences,
    taxRate: federalRate,
    stateTaxRate: stateRate,
    taxCredits: money(input.taxCredits ?? 0),
    estimatedPayments: money(input.estimatedPayments ?? 0),
    nolUtilization: money(input.nolUtilization ?? 0),
    asOfDate: input.period,
  });

  const deferredTax = calculateDeferredTax(
    temporaryDifferences,
    {},
    {},
    {
      deductible_temporary: federalRate,
      taxable_temporary: federalRate,
      TEMP_OTHER: federalRate,
    },
  );

  const rollforward = generateRollforward({
    priorYear: {
      deferredTaxLines: [],
      valuationAllowance: money(0),
      nolCarryforward: money(0),
      taxCreditCarryforward: money(0),
    },
    currentYear: {
      temporaryDifferences,
      nolUtilized: money(input.nolUtilization ?? 0),
      nolGenerated: money(0),
      creditsUtilized: money(0),
      creditsGenerated: money(input.taxCredits ?? 0),
      valuationAllowanceChange: money(0),
      taxRateChanges: [],
    },
  });

  const etr = calculateETR({
    bookIncome: currentTax.bookIncome,
    federalTaxRate: federalRate,
    federalTax: currentTax.federalTax,
    stateTax: currentTax.stateTax,
    permanentDifferences,
    taxCredits: currentTax.taxCredits,
    otherAdjustments: [],
  });

  const journalEntries = generateJournalEntries(
    currentTax,
    deferredTax,
    money(0),
    input.entityId,
    input.period,
  );

  const totalTaxExpense = currentTax.totalTaxAfterCredits.plus(deferredTax.netDeferredTaxExpense);
  const effectiveTaxRate = bookIncome.greaterThan(0) ? totalTaxExpense.div(bookIncome) : money(0);

  return {
    summary: {
      bookIncome: bookIncome.toNumber(),
      totalTaxExpense: totalTaxExpense.toNumber(),
      effectiveTaxRate: effectiveTaxRate.toNumber(),
      currentTaxExpense: currentTax.totalTaxAfterCredits.toNumber(),
      deferredTaxExpense: deferredTax.netDeferredTaxExpense.toNumber(),
      taxPayable: currentTax.taxPayable.toNumber(),
    },
    currentTax: {
      bookIncome: currentTax.bookIncome.toNumber(),
      totalPermanentAdjustments: currentTax.totalPermanentAdjustments.toNumber(),
      taxableIncome: currentTax.taxableIncome.toNumber(),
      federalTaxRate: currentTax.federalTaxRate.toNumber(),
      federalTax: currentTax.federalTax.toNumber(),
      stateTax: currentTax.stateTax.toNumber(),
      totalTaxBeforeCredits: currentTax.totalTaxBeforeCredits.toNumber(),
      taxCredits: currentTax.taxCredits.toNumber(),
      nolUtilization: currentTax.nolUtilization.toNumber(),
      totalTaxAfterCredits: currentTax.totalTaxAfterCredits.toNumber(),
      estimatedPayments: currentTax.estimatedPayments.toNumber(),
      taxPayable: currentTax.taxPayable.toNumber(),
      effectiveTaxRate: currentTax.effectiveTaxRate.toNumber(),
    },
    deferredTax: {
      totalOpeningDTA: deferredTax.totalOpeningDTA.toNumber(),
      totalOpeningDTL: deferredTax.totalOpeningDTL.toNumber(),
      totalClosingDTA: deferredTax.totalClosingDTA.toNumber(),
      totalClosingDTL: deferredTax.totalClosingDTL.toNumber(),
      netDeferredTaxExpense: deferredTax.netDeferredTaxExpense.toNumber(),
      lines: deferredTax.lines.map((line) => ({
        timingCategory: line.timingCategory,
        openingBalance: line.openingBalance.toNumber(),
        currentYearChange: line.currentYearChange.toNumber(),
        taxRate: line.taxRate.toNumber(),
        deferredTaxAmount: line.deferredTaxAmount.toNumber(),
        reversals: line.reversals.toNumber(),
        closingBalance: line.closingBalance.toNumber(),
        dtType: line.dtType,
      })),
    },
    rollforward: {
      deferredTaxRollforward: rollforward.deferredTaxRollforward.map((line) => ({
        timingCategory: line.timingCategory,
        openingBalance: line.openingBalance.toNumber(),
        currentYearChange: line.currentYearChange.toNumber(),
        taxRate: line.taxRate.toNumber(),
        deferredTaxAmount: line.deferredTaxAmount.toNumber(),
        reversals: line.reversals.toNumber(),
        closingBalance: line.closingBalance.toNumber(),
        dtType: line.dtType,
      })),
      nolRollforward: decimalRecordToNumber(rollforward.nolRollforward),
      creditRollforward: decimalRecordToNumber(rollforward.creditRollforward),
      valuationAllowance: decimalRecordToNumber(rollforward.valuationAllowance),
    },
    etr: {
      statutoryRate: etr.statutoryRate.toNumber(),
      statutoryTax: etr.statutoryTax.toNumber(),
      effectiveTaxRate: etr.effectiveTaxRate.toNumber(),
      totalTaxExpense: etr.totalTaxExpense.toNumber(),
      lines: etr.lines.map((line) => ({
        description: line.description,
        amount: line.amount.toNumber(),
        taxImpact: line.taxImpact.toNumber(),
        rateImpact: line.rateImpact.toNumber(),
      })),
    },
    journalEntries: journalEntries.map((entry) => ({
      type: entry.type,
      entityId: entry.entityId,
      period: entry.period,
      lines: entry.lines.map((line) => ({
        accountId: line.accountId,
        debit: line.debit.toNumber(),
        credit: line.credit.toNumber(),
        memo: line.memo,
      })),
      totalDebit: entry.totalDebit.toNumber(),
      totalCredit: entry.totalCredit.toNumber(),
    })),
  };
}

function money(value: number | string) {
  const decimal = new Decimal(value ?? 0);
  if (!decimal.isFinite()) throw new Error(`Invalid monetary value: ${value}`);
  return decimal;
}

function rate(value: number | string) {
  const decimal = money(value);
  if (decimal.isNegative() || decimal.greaterThan(1)) throw new Error(`Invalid tax rate: ${value}`);
  return decimal;
}

function decimalRecordToNumber(record: Record<string, ReturnType<typeof money>>) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.toNumber()]));
}
