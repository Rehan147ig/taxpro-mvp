import Decimal from 'decimal.js';
import { Jurisdiction } from './types.js';
import type {
  BookTaxDifference, CurrentTaxInput, CurrentTaxResult,
  DeferredTaxInput, DeferredTaxLine, DeferredTaxResult,
  ETRInput, ETRResult, RollforwardInput, RollforwardResult,
  JournalEntry, USD, TaxRate, TrialBalanceLine, Account, TaxMapping,
} from './types.js';
import { calculateCurrentTax } from './current-tax.js';
import { calculateDeferredTax, calculateDeferredTaxLine } from './deferred-tax.js';
import { calculateETR } from './etr-reconciliation.js';
import { generateRollforward } from './rollforward.js';
import { generateJournalEntries } from './journal-entries.js';
import { computeBookTaxDifferences } from './book-tax-diff.js';
import { getRateForFiscalYear, US_RATES_BY_FISCAL_YEAR, UK_RATES_BY_FISCAL_YEAR } from './uk-frs102-s29/rules.js';

Decimal.set = ((_config: Decimal.Config): typeof Decimal => {
  throw new Error(
    'Decimal.set/config is frozen by @taxpro/tax-engine to prevent cross-jurisdiction config contamination. ' +
    'Use Decimal.clone() to create an isolated constructor if you need different precision.',
  );
}) as typeof Decimal.set;
Decimal.config = Decimal.set as typeof Decimal.config;
Object.freeze(Decimal.set);
Object.freeze(Decimal.config);

export interface TaxEngine {
  readonly jurisdiction: Jurisdiction;
  readonly Decimal: typeof Decimal;
  getRateForFiscalYear(fiscalYear: string, categoryRates?: Record<string, TaxRate>): TaxRate;
  calculateCurrentTax(input: CurrentTaxInput): CurrentTaxResult;
  calculateDeferredTax(
    temporaryDifferences: BookTaxDifference[],
    priorYearDTAByCategory: Record<string, USD>,
    priorYearDTLByCategory: Record<string, USD>,
    taxRates: Record<string, TaxRate>,
    probableRecoveryMap?: Record<string, boolean>,
    asOfDate?: string,
  ): DeferredTaxResult;
  calculateDeferredTaxLine(input: DeferredTaxInput): DeferredTaxLine;
  calculateETR(input: ETRInput): ETRResult;
  generateRollforward(input: RollforwardInput): RollforwardResult;
  generateJournalEntries(
    currentTax: CurrentTaxResult,
    deferredTax: DeferredTaxResult,
    valuationAllowanceChange: USD,
    entityId: string,
    period: string,
  ): JournalEntry[];
  computeBookTaxDifferences(
    trialBalance: TrialBalanceLine[],
    accounts: Account[],
    mappings: Map<string, TaxMapping>,
    period: string,
    assetAgeYears?: number,
  ): BookTaxDifference[];
}

export function createEngine(jurisdiction: Jurisdiction): TaxEngine {
  const yearTable = jurisdiction === Jurisdiction.UK_FRS102_S29 ? UK_RATES_BY_FISCAL_YEAR : US_RATES_BY_FISCAL_YEAR;

  return {
    jurisdiction,
    Decimal,

    getRateForFiscalYear(fiscalYear, categoryRates = {}) {
      return getRateForFiscalYear(jurisdiction, fiscalYear, categoryRates, yearTable);
    },

    calculateCurrentTax(input) {
      return calculateCurrentTax(input);
    },

    calculateDeferredTax(diffs, priorDTA, priorDTL, taxRates, probableRecoveryMap, asOfDate) {
      return calculateDeferredTax(diffs, priorDTA, priorDTL, taxRates, jurisdiction, probableRecoveryMap, asOfDate);
    },

    calculateDeferredTaxLine(input) {
      return calculateDeferredTaxLine({ ...input, jurisdiction });
    },

    calculateETR(input) {
      return calculateETR(input);
    },

    generateRollforward(input) {
      return generateRollforward(input);
    },

    generateJournalEntries(currentTax, deferredTax, valuationAllowanceChange, entityId, period) {
      return generateJournalEntries(currentTax, deferredTax, valuationAllowanceChange, entityId, period);
    },

    computeBookTaxDifferences(trialBalance, accounts, mappings, period, assetAgeYears) {
      return computeBookTaxDifferences(trialBalance, accounts, mappings, period, assetAgeYears);
    },
  };
}
