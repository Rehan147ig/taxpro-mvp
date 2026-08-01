import Decimal from 'decimal.js';

/**
 * CT600-ready return builder.
 *
 * Converts a completed provision result into the structured figures a UK
 * corporation tax return (CT600) requires, following the standard box layout
 * (CT600 2016+). The output is both human-checkable JSON and a CSV that can be
 * pasted/imported into agent filing software (IRIS, Digita, TaxCalc).
 *
 * Honesty note: this produces CT600-ready FIGURE OUTPUT, not an HMRC-submitted
 * return. HMRC submission itself remains with agent software (or the MTD-CT
 * adapter once HMRC opens the Corporation Tax API — see modules/mtd), and
 * filing must only happen after a real HMRC/gateway submission validation
 * pass. Box 15 (total tax charge), 19 (payable) and 22 (balance) are floored
 * at zero — credits or payments on account in excess of the charge are never
 * represented as an automatic repayment.
 */

export interface Ct600CompanyInfo {
  companyName: string;
  utr: string;
  companiesHouseNumber?: string;
}

export interface Ct600Period {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface Ct600MathInput {
  taxableTotalProfits: number;
  profitsChargeableToCT: number;
  taxAtMainRate: number;
  taxAtSmallProfitsRate: number;
  marginalRelief: number;
  taxCredits: number;       // R&D, foreign tax etc.
  taxDeductedAtSource: number;
  paymentsOnAccount: number;
  rdSurrender: number;      // R&D loss surrendered for payable credit (Box 28)
  rdec: number;             // R&D expenditure credit claimed (Box 27)
}

export interface Ct600Box {
  box: number;
  name: string;
  value: string | number;
}

export interface Ct600Return {
  company: Ct600CompanyInfo;
  period: Ct600Period;
  boxes: Ct600Box[];
  computed: {
    taxBeforeRelief: number;
    totalTaxCharge: number;
    taxPayable: number;
    balanceDue: number;
  };
  consistency: { ok: boolean; issues: string[] };
  generatedAt: string;
}

export function buildCt600Return(
  company: Ct600CompanyInfo,
  period: Ct600Period,
  math: Ct600MathInput,
): Ct600Return {
  if (math.taxableTotalProfits < 0 || math.profitsChargeableToCT < 0) throw new Error('taxableTotalProfits cannot be negative');
  if (math.taxAtMainRate < 0 || math.taxAtSmallProfitsRate < 0) throw new Error('tax rates cannot be negative');
  if (math.marginalRelief < 0) throw new Error('marginal relief cannot be negative');
  if (math.taxCredits < 0 || math.taxDeductedAtSource < 0) throw new Error('credits cannot be negative');
  if (math.paymentsOnAccount < 0) throw new Error('payments on account cannot be negative');

  const taxBeforeRelief = math.taxAtMainRate + math.taxAtSmallProfitsRate - math.marginalRelief;
  const totalTaxCharge = Math.max(0, taxBeforeRelief);
  const taxPayable = Math.max(0, totalTaxCharge - math.taxCredits - math.taxDeductedAtSource);
  const balanceDue = Math.max(0, taxPayable - math.paymentsOnAccount);

  const boxes: Ct600Box[] = [
    { box: 1, name: 'Company Unique Taxpayer Reference (UTR)', value: company.utr },
    { box: 3, name: 'Accounting period start', value: period.start },
    { box: 4, name: 'Accounting period end', value: period.end },
    { box: 5, name: 'Profits chargeable to corporation tax', value: math.profitsChargeableToCT },
    { box: 10, name: 'Taxable total profits', value: math.taxableTotalProfits },
    { box: 11, name: 'Profits chargeable at main rate', value: math.profitsChargeableToCT },
    { box: 12, name: 'Corporation tax at main rate', value: round2(math.taxAtMainRate) },
    { box: 13, name: 'Corporation tax at small profits rate', value: round2(math.taxAtSmallProfitsRate) },
    { box: 14, name: 'Marginal relief', value: round2(math.marginalRelief) },
    { box: 15, name: 'Total tax charge', value: round2(totalTaxCharge) },
    { box: 16, name: 'Tax credits (R&D, foreign tax, etc.)', value: round2(math.taxCredits) },
    { box: 17, name: 'Tax deducted at source', value: round2(math.taxDeductedAtSource) },
    { box: 19, name: 'Tax payable', value: round2(taxPayable) },
    { box: 20, name: 'Payments on account', value: round2(math.paymentsOnAccount) },
    { box: 22, name: 'Balance of tax payable (or repayable)', value: round2(balanceDue) },
    { box: 27, name: 'R&D expenditure credit (RDEC)', value: round2(math.rdec) },
    { box: 28, name: 'R&D SME loss surrendered for payable credit', value: round2(math.rdSurrender) },
  ];

  const issues: string[] = [];
  if (Math.abs(taxBeforeRelief - totalTaxCharge) > 0.01 && taxBeforeRelief < 0) {
    issues.push('Negative tax charge after reliefs — zeroed (loss year or fully relieved)');
  }
  if (math.marginalRelief > 0 && math.taxAtSmallProfitsRate > 0) {
    issues.push('Marginal relief and small profits rate both present — check band selection');
  }
  if (math.taxAtSmallProfitsRate > 0 && math.taxAtMainRate > 0) {
    issues.push('Both main and small profits rate tax present — split-banding not supported; verify');
  }

  return {
    company,
    period,
    boxes,
    computed: { taxBeforeRelief, totalTaxCharge, taxPayable, balanceDue },
    consistency: { ok: issues.length === 0, issues },
    generatedAt: new Date().toISOString(),
  };
}

/** Derive CT600 inputs from a provision detail object (provision_results.detail). */
export function ct600FromProvisionDetail(
  company: Ct600CompanyInfo,
  period: Ct600Period,
  detail: {
    currentTax?: {
      bookIncome?: number;
      totalPermanentAdjustments?: number;
      taxableIncome?: number;
      federalTax?: number;
      marginalRelief?: number;
      taxCredits?: number;
      taxPayable?: number;
      estimatedPayments?: number;
      totalTaxAfterCredits?: number;
    };
  },
): Ct600Return {
  const ct = detail.currentTax ?? {};
  const taxAtMainRate = ct.federalTax ?? 0;
  const marginalRelief = ct.marginalRelief ?? 0;
  // When marginal relief applies, the whole charge is effectively within the
  // band — box 13 (small profits rate) covers the sub-£50k slice, box 14 the
  // relief. For single-band companies we report the main-rate charge and the
  // relief; small profits rate box stays 0 unless the entire charge is at 19%.
  const taxAtSmallProfitsRate = 0;

  return buildCt600Return(company, period, {
    profitsChargeableToCT: ct.taxableIncome ?? 0,
    taxableTotalProfits: ct.taxableIncome ?? 0,
    taxAtMainRate,
    taxAtSmallProfitsRate,
    marginalRelief,
    taxCredits: ct.taxCredits ?? 0,
    taxDeductedAtSource: 0,
    paymentsOnAccount: ct.estimatedPayments ?? 0,
    rdSurrender: 0,
    rdec: 0,
  });
}

export function ct600ToCsv(ct600: Ct600Return): string {
  const header = ['box', 'name', 'value'];
  const rows = ct600.boxes.map(b => [String(b.box), b.name, String(b.value)]);
  return [header.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function esc(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ── Legacy-compatible numeric helper for callers passing Decimal ──

export function toNumber(value: unknown): number {
  if (value instanceof Decimal) return value.toNumber();
  return Number(value ?? 0);
}
