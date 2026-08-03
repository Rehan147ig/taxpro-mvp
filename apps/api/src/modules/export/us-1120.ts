/**
 * Form 1120-ready return builder (US federal corporation income tax).
 *
 * Converts a completed provision result into the structured figures a US
 * federal corporate income tax return (Form 1120) requires, including an
 * M-1-style book-tax reconciliation. The output is both human-checkable JSON
 * and a CSV that can be pasted/imported into agent filing software (UltraTax,
 * Drake, ProSystem fx, Lacerte).
 *
 * Honesty note: this produces 1120-ready FIGURE OUTPUT, not an IRS-filed
 * return. IRS submission itself remains with agent software (or the e-file
 * adapter once the e-file schema is implemented), and filing must only happen
 * after a real IRS/e-file submission validation pass. The amount-owed line is
 * floored at zero and an overpayment is only ever reported as a separate
 * claimable line — a refund is never assumed to have been paid. Schedule M-1
 * is rendered as an M-1-STYLE reconciliation (book income, net permanent
 * adjustments, net temporary adjustments): it does not reproduce the
 * line-by-line M-1 additions/deductions itemization, which requires the full
 * underlying workpapers.
 *
 * Rate basis: 21% flat federal corporate rate for tax years beginning after
 * 31 December 2017 (TCJA, IRC 11(b)). Earlier years are not modeled — callers
 * must supply a rate for those periods.
 */

export interface Us1120CompanyInfo {
  companyName: string;
  ein: string; // 9 digits
  state?: string; // state of incorporation, reference only
}

export interface Us1120Period {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export interface Us1120MathInput {
  bookIncome: number; // net income per books (M-1 line 1) — may be negative
  permanentAdjustments: number; // net permanent book-tax differences (positive = income, negative = deduction)
  temporaryAdjustments: number; // net temporary/timing differences incl. MACRS (positive = income, negative = deduction)
  nolDeduction: number; // NOL deduction (1120 line 31)
  federalRate: number; // statutory federal rate, default 0.21 (TCJA)
  taxCredits: number; // total credits incl. foreign tax credit, R&D credit (Schedule J)
  estimatedPayments: number; // 2023 estimated tax payments (line 35a)
  overpaymentsApplied: number; // prior-year overpayment applied (line 35b)
}

export interface Us1120Line {
  line: string;
  section: 'm1' | 'incomeTax' | 'payments' | 'owed';
  name: string;
  value: string | number;
}

export interface Us1120Return {
  company: Us1120CompanyInfo;
  period: Us1120Period;
  m1: {
    bookIncome: number;
    permanentAdjustments: number;
    temporaryAdjustments: number;
    taxableIncomeBeforeNol: number;
  };
  incomeTax: {
    taxableIncomeBeforeNol: number;
    nolDeduction: number;
    taxableIncome: number;
    taxBeforeCredits: number;
    taxCredits: number;
    totalTax: number;
  };
  payments: {
    estimatedPayments: number;
    overpaymentsApplied: number;
    totalPayments: number;
  };
  owed: {
    amountOwed: number;
    overpayment: number;
  };
  rate: {
    federalRate: number;
    basis: string;
  };
  lines: Us1120Line[];
  consistency: { ok: boolean; issues: string[] };
  generatedAt: string;
}

export function buildUs1120Return(
  company: Us1120CompanyInfo,
  period: Us1120Period,
  math: Us1120MathInput,
): Us1120Return {
  if (!/^\d{9}$/.test(company.ein.replace(/-/g, ''))) throw new Error('ein must be 9 digits');
  if (math.nolDeduction < 0) throw new Error('nolDeduction cannot be negative');
  if (math.federalRate < 0 || math.federalRate > 1) throw new Error('federalRate must be between 0 and 1');
  if (math.taxCredits < 0) throw new Error('taxCredits cannot be negative');
  if (math.estimatedPayments < 0 || math.overpaymentsApplied < 0) throw new Error('payments cannot be negative');

  const taxableIncomeBeforeNol = math.bookIncome + math.permanentAdjustments + math.temporaryAdjustments;
  const taxableIncome = Math.max(0, taxableIncomeBeforeNol - math.nolDeduction);
  const taxBeforeCredits = Math.max(0, taxableIncome) * math.federalRate;
  const totalTax = Math.max(0, taxBeforeCredits - math.taxCredits);
  const totalPayments = math.estimatedPayments + math.overpaymentsApplied;
  const amountOwed = Math.max(0, totalTax - totalPayments);
  const overpayment = Math.max(0, totalPayments - totalTax);

  const lines: Us1120Line[] = [
    { line: 'M-1.1', section: 'm1', name: 'Net income (loss) per books', value: round2(math.bookIncome) },
    { line: 'M-1.2', section: 'm1', name: 'Net permanent book-tax adjustments', value: round2(math.permanentAdjustments) },
    { line: 'M-1.3', section: 'm1', name: 'Net temporary/timing adjustments (incl. MACRS)', value: round2(math.temporaryAdjustments) },
    { line: 'M-1.10', section: 'm1', name: 'Taxable income (loss) before NOL deduction (line 6 less line 9)', value: round2(taxableIncomeBeforeNol) },
    { line: '1120.30', section: 'incomeTax', name: 'Taxable income before net operating loss deduction and special deductions', value: round2(taxableIncomeBeforeNol) },
    { line: '1120.31', section: 'incomeTax', name: 'Net operating loss deduction', value: round2(math.nolDeduction) },
    { line: '1120.33', section: 'incomeTax', name: 'Taxable income', value: round2(taxableIncome) },
    { line: '1120.34a', section: 'incomeTax', name: 'Tax before credits', value: round2(taxBeforeCredits) },
    { line: '1120.34b', section: 'incomeTax', name: 'Total credits (foreign tax credit, R&D credit, etc.)', value: round2(math.taxCredits) },
    { line: '1120.34', section: 'incomeTax', name: 'Total tax', value: round2(totalTax) },
    { line: '1120.35a', section: 'payments', name: '2023 estimated tax payments', value: round2(math.estimatedPayments) },
    { line: '1120.35b', section: 'payments', name: '2022 overpayment applied', value: round2(math.overpaymentsApplied) },
    { line: '1120.35', section: 'payments', name: 'Total payments and refundable credits', value: round2(totalPayments) },
    { line: '1120.36', section: 'owed', name: 'Amount you owe', value: round2(amountOwed) },
    { line: '1120.37', section: 'owed', name: 'Amount you overpaid', value: round2(overpayment) },
  ];

  const issues: string[] = [];
  if (math.taxCredits > taxBeforeCredits) {
    issues.push('Credits exceed tax before credits — total tax floored at zero; verify credit limitation rules (foreign tax credit, R&D 25% cap)');
  }
  if (taxableIncomeBeforeNol < 0) {
    issues.push('Negative taxable income before NOL — loss year; amount owed floored at zero');
  }
  if (math.nolDeduction > 0 && math.nolDeduction > 0.8 * taxableIncomeBeforeNol) {
    issues.push('NOL deduction exceeds 80% of taxable income before NOL — IRC 172(a) 80% limitation not satisfied');
  }
  if (math.federalRate !== 0.21 && period.start >= '2018-01-01') {
    issues.push(`Federal rate ${math.federalRate} used for a TCJA period — statutory rate is 21%`);
  }

  return {
    company: { ...company, ein: company.ein.replace(/-/g, '') },
    period,
    m1: { bookIncome: math.bookIncome, permanentAdjustments: math.permanentAdjustments, temporaryAdjustments: math.temporaryAdjustments, taxableIncomeBeforeNol },
    incomeTax: { taxableIncomeBeforeNol, nolDeduction: math.nolDeduction, taxableIncome, taxBeforeCredits, taxCredits: math.taxCredits, totalTax },
    payments: { estimatedPayments: math.estimatedPayments, overpaymentsApplied: math.overpaymentsApplied, totalPayments },
    owed: { amountOwed, overpayment },
    rate: {
      federalRate: math.federalRate,
      basis: '21% flat federal corporate rate for tax years beginning after 31 December 2017 (TCJA, IRC 11(b)); earlier years not modeled.',
    },
    lines,
    consistency: { ok: issues.length === 0, issues },
    generatedAt: new Date().toISOString(),
  };
}

/** Derive 1120 inputs from a provision detail object (provision_results.detail). */
export function us1120FromProvisionDetail(
  company: Us1120CompanyInfo,
  period: Us1120Period,
  detail: {
    currentTax?: {
      bookIncome?: number;
      totalPermanentAdjustments?: number;
      taxableIncome?: number;
      federalTax?: number;
      taxCredits?: number;
      taxPayable?: number;
      estimatedPayments?: number;
      totalTaxAfterCredits?: number;
    };
  },
  overrides?: { federalRate?: number; nolDeduction?: number; overpaymentsApplied?: number },
): Us1120Return {
  const ct = detail.currentTax ?? {};
  const bookIncome = ct.bookIncome ?? 0;
  const permanentAdjustments = ct.totalPermanentAdjustments ?? 0;
  const taxableIncomeBeforeNol = ct.taxableIncome ?? bookIncome;
  // Net temporary differences are whatever reconciles the model's taxable
  // income back to book — never asserted to be a full M-1 itemization.
  const temporaryAdjustments = taxableIncomeBeforeNol - bookIncome - permanentAdjustments;

  return buildUs1120Return(company, period, {
    bookIncome,
    permanentAdjustments,
    temporaryAdjustments,
    nolDeduction: overrides?.nolDeduction ?? 0,
    federalRate: overrides?.federalRate ?? 0.21,
    taxCredits: ct.taxCredits ?? 0,
    estimatedPayments: ct.estimatedPayments ?? 0,
    overpaymentsApplied: overrides?.overpaymentsApplied ?? 0,
  });
}

export function us1120ToCsv(us1120: Us1120Return): string {
  const header = ['line', 'name', 'value'];
  const rows = us1120.lines.map(l => [l.line, l.name, String(l.value)]);
  return [header.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function esc(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
