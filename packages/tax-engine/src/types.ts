// ── Core domain types for the tax engine ──
// All monetary values use Decimal for audit-safe fixed-point arithmetic.

import Decimal from 'decimal.js';

export type USD = InstanceType<typeof Decimal>;
export type TaxRate = InstanceType<typeof Decimal>;
export type Ratio = InstanceType<typeof Decimal>;
export type Years = number;

export interface Entity {
  id: string;
  name: string;
  currency: string;
  taxJurisdiction: string;
  parentEntityId?: string;
  taxRate: TaxRate;
  stateTaxRate?: TaxRate;
}

export interface Account {
  id: string;
  accountNumber: string;
  name: string;
  type: 'Income' | 'Expense' | 'Asset' | 'Liability' | 'Equity';
}

export interface TrialBalanceLine {
  entityId: string;
  accountId: string;
  period: string;
  balance: USD;
}

export type TaxAccountType =
  | 'PERM_MEALS_ENTERTAINMENT'
  | 'PERM_PENALTIES_FINES'
  | 'PERM_DIVIDENDS_RECEIVED_DEDUCTION'
  | 'PERM_LIFE_INSURANCE'
  | 'PERM_TAX_EXEMPT_INTEREST'
  | 'PERM_NONDEDUCTIBLE_GOODWILL'
  | 'PERM_OTHER'
  | 'TEMP_DEPRECIATION'
  | 'TEMP_AMORTIZATION'
  | 'TEMP_ACCELERATED_DEPRECIATION'
  | 'TEMP_BONUS_DEPRECIATION'
  | 'TEMP_SECTION_179'
  | 'TEMP_RESEARCH_CREDIT'
  | 'TEMP_BAD_DEBT_RESERVE'
  | 'TEMP_INVENTORY_RESERVE'
  | 'TEMP_WARRANTY_RESERVE'
  | 'TEMP_DEFERRED_REVENUE'
  | 'TEMP_ACCRUED_LIABILITIES'
  | 'TEMP_PENSION'
  | 'TEMP_NOL_CARRYFORWARD'
  | 'TEMP_TAX_CREDIT_CARRYFORWARD'
  | 'TEMP_OTHER'
  | 'NODIFF_CASH'
  | 'NODIFF_AR'
  | 'NODIFF_AP'
  | 'NODIFF_REVENUE'
  | 'NODIFF_SALARIES'
  | 'NODIFF_RENT'
  | 'NODIFF_UTILITIES'
  | 'NODIFF_OTHER';

export interface TaxMapping {
  accountId: string;
  taxAccountType: TaxAccountType;
  bookTreatment: 'permanent' | 'temporary' | 'no_diff';
  timingCategory?: 'deductible_temporary' | 'taxable_temporary';
  confidenceScore: Ratio;
}

export interface BookTaxDifference {
  accountId: string;
  entityId: string;
  period: string;
  bookBalance: USD;
  taxBalance: USD;
  difference: USD;
  diffType: 'permanent' | 'temporary' | 'no_diff';
  timingCategory?: string;
  reversalPeriod?: string;
}

export interface PermanentDifferenceItem {
  amount: USD;
  label: string;
}

export interface CurrentTaxInput {
  bookIncome: USD;
  permanentDifferences: PermanentDifferenceItem[];
  taxRate: TaxRate;
  stateTaxRate?: TaxRate;
  taxCredits: USD;
  estimatedPayments: USD;
  nolUtilization: USD;
  asOfDate: string;
}

export interface CurrentTaxResult {
  bookIncome: USD;
  totalPermanentAdjustments: USD;
  taxableIncome: USD;
  federalTaxRate: TaxRate;
  federalTax: USD;
  stateTax: USD;
  totalTaxBeforeCredits: USD;
  taxCredits: USD;
  nolUtilization: USD;
  totalTaxAfterCredits: USD;
  estimatedPayments: USD;
  taxPayable: USD;
  effectiveTaxRate: TaxRate;
}

export interface DeferredTaxInput {
  entityId: string;
  timingCategory: string;
  openingDTA: USD;
  openingDTL: USD;
  currentYearTemporaryChange: USD;
  taxRate: TaxRate;
  dtType: 'DTA' | 'DTL';
}

export interface DeferredTaxLine {
  timingCategory: string;
  openingBalance: USD;
  currentYearChange: USD;
  taxRate: TaxRate;
  deferredTaxAmount: USD;
  reversals: USD;
  closingBalance: USD;
  dtType: 'DTA' | 'DTL';
}

export interface DeferredTaxResult {
  lines: DeferredTaxLine[];
  totalOpeningDTA: USD;
  totalOpeningDTL: USD;
  totalClosingDTA: USD;
  totalClosingDTL: USD;
  netDeferredTaxExpense: USD;
}

export interface RollforwardInput {
  priorYear: {
    deferredTaxLines: DeferredTaxLine[];
    valuationAllowance: USD;
    nolCarryforward: USD;
    taxCreditCarryforward: USD;
  };
  currentYear: {
    temporaryDifferences: BookTaxDifference[];
    nolUtilized: USD;
    nolGenerated: USD;
    creditsUtilized: USD;
    creditsGenerated: USD;
    valuationAllowanceChange: USD;
    taxRateChanges: { category: string; oldRate: TaxRate; newRate: TaxRate }[];
  };
}

export interface RollforwardResult {
  deferredTaxRollforward: DeferredTaxLine[];
  nolRollforward: { opening: USD; generated: USD; utilized: USD; closing: USD };
  creditRollforward: { opening: USD; generated: USD; utilized: USD; closing: USD };
  valuationAllowance: { opening: USD; change: USD; closing: USD };
}

export interface ETRInput {
  bookIncome: USD;
  federalTaxRate: TaxRate;
  federalTax: USD;
  stateTax: USD;
  permanentDifferences: PermanentDifferenceItem[];
  taxCredits: USD;
  otherAdjustments: PermanentDifferenceItem[];
}

export interface ETRLine {
  description: string;
  amount: USD;
  taxImpact: USD;
  rateImpact: TaxRate;
}

export interface ETRResult {
  statutoryRate: TaxRate;
  statutoryTax: USD;
  lines: ETRLine[];
  totalTaxExpense: USD;
  effectiveTaxRate: TaxRate;
}

export interface JournalEntryLine {
  accountId: string;
  debit: USD;
  credit: USD;
  memo: string;
}

export interface JournalEntry {
  type: 'current_tax' | 'deferred_tax' | 'valuation_allowance';
  entityId: string;
  period: string;
  lines: JournalEntryLine[];
  totalDebit: USD;
  totalCredit: USD;
}

export interface ProvisionSummary {
  period: string;
  entityId: string;
  bookIncome: USD;
  currentTax: CurrentTaxResult;
  deferredTax: DeferredTaxResult;
  rollforward: RollforwardResult;
  etr: ETRResult;
  journalEntries: JournalEntry[];
}

// ── Input validation helpers ──

export function validatePositive(label: string, value: USD): void {
  if (value.isNegative()) {
    throw new Error(`${label} cannot be negative. Got: ${value.toString()}`);
  }
}

export function validateNonZero(label: string, value: USD): void {
  if (value.isZero()) {
    throw new Error(`${label} cannot be zero.`);
  }
}

export function validateRate(label: string, rate: TaxRate): void {
  if (rate.isNegative() || rate.greaterThan(1)) {
    throw new Error(`${label} must be between 0 and 1. Got: ${rate.toString()}`);
  }
}
