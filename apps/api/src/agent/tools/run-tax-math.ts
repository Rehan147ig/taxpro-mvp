import Decimal from 'decimal.js';
import { logger } from '../../lib/logger.js';
import { createEngine, Jurisdiction, etrAdjustmentsForMarginalRelief } from '@taxpro/tax-engine';

const engine = createEngine(Jurisdiction.US_ASC740);

const parameters = {
  type: 'object',
  properties: {
    bookIncome: { type: 'number', description: 'Net book income (pretax)' },
    permanentDifferences: {
      type: 'array', items: { type: 'object', properties: { amount: { type: 'number' }, label: { type: 'string' } }, required: ['amount', 'label'] },
      description: 'Permanent book-tax differences',
    },
    temporaryDifferences: {
      type: 'array', items: { type: 'object', properties: { accountId: { type: 'string' }, entityId: { type: 'string' }, period: { type: 'string' }, bookBalance: { type: 'number' }, taxBalance: { type: 'number' }, difference: { type: 'number' }, diffType: { type: 'string' }, timingCategory: { type: 'string' } }, required: ['accountId', 'entityId', 'period', 'bookBalance', 'taxBalance', 'difference', 'diffType'] },
      description: 'Temporary book-tax differences',
    },
    federalRate: { type: 'number', description: 'Federal corporate tax rate (e.g. 0.21)' },
    stateRate: { type: 'number', description: 'State tax rate (optional)' },
    taxCredits: { type: 'number', description: 'Tax credits' },
    estimatedPayments: { type: 'number', description: 'Estimated tax payments' },
    nolUtilization: { type: 'number', description: 'NOL carryforward utilization' },
    entityId: { type: 'string', description: 'Entity ID for journal entries' },
    period: { type: 'string', description: 'Period in YYYY-MM-DD format' },
  },
  required: ['bookIncome', 'federalRate', 'entityId', 'period'],
  additionalProperties: false,
};

export const runTaxMath = {
  spec: { description: 'Execute ASC 740 tax provision calculations using the deterministic tax engine. Returns current tax, deferred tax, ETR reconciliation, and journal entries.', parameters },
  execute: async (args: Record<string, any>) => {
    logger.info({ bookIncome: args.bookIncome }, '[Eve] Running tax math');

    const currentTax = engine.calculateCurrentTax({
      bookIncome: new Decimal(args.bookIncome),
      permanentDifferences: (args.permanentDifferences ?? []).map((pd: any) => ({ amount: new Decimal(pd.amount), label: pd.label })),
      taxRate: new Decimal(args.federalRate),
      stateTaxRate: args.stateRate ? new Decimal(args.stateRate) : undefined,
      taxCredits: new Decimal(args.taxCredits ?? 0),
      estimatedPayments: new Decimal(args.estimatedPayments ?? 0),
      nolUtilization: new Decimal(args.nolUtilization ?? 0),
      asOfDate: args.period,
    });

    const deferredTax = engine.calculateDeferredTax(
      (args.temporaryDifferences ?? []).map((d: any) => ({
        accountId: d.accountId, entityId: d.entityId, period: d.period,
        bookBalance: new Decimal(d.bookBalance), taxBalance: new Decimal(d.taxBalance),
        difference: new Decimal(d.difference), diffType: d.diffType,
        timingCategory: d.timingCategory ?? 'TEMP_OTHER',
      })),
      {}, {},
      { deductible_temporary: new Decimal(args.federalRate), taxable_temporary: new Decimal(args.federalRate), TEMP_OTHER: new Decimal(args.federalRate) },
    );

    const journalEntries = engine.generateJournalEntries(currentTax, deferredTax, new Decimal(0), args.entityId, args.period);

    const etr = engine.calculateETR({
      bookIncome: currentTax.bookIncome, federalTaxRate: currentTax.federalTaxRate,
      federalTax: currentTax.federalTax, stateTax: currentTax.stateTax,
      permanentDifferences: (args.permanentDifferences ?? []).map((pd: any) => ({ amount: new Decimal(pd.amount), label: pd.label })),
      taxCredits: currentTax.taxCredits, otherAdjustments: etrAdjustmentsForMarginalRelief(currentTax),
    });

    const totalTaxExpense = currentTax.totalTaxAfterCredits.plus(deferredTax.netDeferredTaxExpense);
    const effectiveTaxRate = args.bookIncome !== 0 ? totalTaxExpense.div(args.bookIncome) : new Decimal(0);

    return {
      summary: { bookIncome: args.bookIncome, totalTaxExpense: totalTaxExpense.toNumber(), effectiveTaxRate: effectiveTaxRate.toNumber(), currentTaxExpense: currentTax.totalTaxAfterCredits.toNumber(), deferredTaxExpense: deferredTax.netDeferredTaxExpense.toNumber(), taxPayable: currentTax.taxPayable.toNumber() },
      currentTax: { bookIncome: currentTax.bookIncome.toNumber(), totalPermanentAdjustments: currentTax.totalPermanentAdjustments.toNumber(), taxableIncome: currentTax.taxableIncome.toNumber(), federalTaxRate: currentTax.federalTaxRate.toNumber(), federalTax: currentTax.federalTax.toNumber(), stateTax: currentTax.stateTax.toNumber(), totalTaxBeforeCredits: currentTax.totalTaxBeforeCredits.toNumber(), taxCredits: currentTax.taxCredits.toNumber(), nolUtilization: currentTax.nolUtilization.toNumber(), totalTaxAfterCredits: currentTax.totalTaxAfterCredits.toNumber(), estimatedPayments: currentTax.estimatedPayments.toNumber(), taxPayable: currentTax.taxPayable.toNumber(), effectiveTaxRate: currentTax.effectiveTaxRate.toNumber() },
      deferredTax: { totalOpeningDTA: deferredTax.totalOpeningDTA.toNumber(), totalOpeningDTL: deferredTax.totalOpeningDTL.toNumber(), totalClosingDTA: deferredTax.totalClosingDTA.toNumber(), totalClosingDTL: deferredTax.totalClosingDTL.toNumber(), netDeferredTaxExpense: deferredTax.netDeferredTaxExpense.toNumber() },
      etr: { statutoryRate: etr.statutoryRate.toNumber(), effectiveTaxRate: etr.effectiveTaxRate.toNumber(), lines: etr.lines.map((l: any) => ({ description: l.description, amount: l.amount.toNumber(), taxImpact: l.taxImpact.toNumber(), rateImpact: l.rateImpact.toNumber() })) },
      journalEntries: journalEntries.map((je: any) => ({ type: je.type, entityId: je.entityId, period: je.period, lines: je.lines.map((l: any) => ({ accountId: l.accountId, debit: l.debit.toNumber(), credit: l.credit.toNumber(), memo: l.memo })), totalDebit: je.totalDebit.toNumber(), totalCredit: je.totalCredit.toNumber() })),
    };
  },
};

