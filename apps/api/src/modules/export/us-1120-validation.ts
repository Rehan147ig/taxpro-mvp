import type { Us1120Return } from './us-1120.js';

/**
 * Form 1120 conformance validation against IRS rules.
 *
 * Rule basis:
 *  - EIN: 9 digits, IRM 21.7.13 / Form 1120 page 1.
 *  - Fiscal year: 12 months unless a short year is authorized; periods here
 *    are checked for length 1–366 days.
 *  - Book-tax reconciliation: M-1 line 10 = book income + net permanent +
 *    net temporary adjustments (Form 1120 Schedule M-1, 2023 revision,
 *    presented as an M-1-STYLE reconciliation — see us-1120.ts).
 *  - Federal rate: 21% for tax years beginning after 31 December 2017
 *    (TCJA, IRC 11(b)); earlier years are not modeled and are skipped.
 *  - NOL deduction: limited to 80% of taxable income computed without the
 *    deduction for post-2017 tax years (IRC 172(a)(2)).
 *  - Amount owed/overpayment arithmetic: 1120 lines 34–37.
 *
 * Honesty: this validates conformance with IRS guidance rules, not an IRS
 * e-file submission. Credit limitations that require a credit-type breakdown
 * (e.g. the post-2022 R&D credit cap of 25% of regular tax exceeding
 * $25,000, IRC 41(a)) cannot be checked from this export and are skipped with
 * a reason.
 */

export interface Us1120Violation {
  ruleId: string;
  message: string;
  line?: string;
}

export interface Us1120ValidationResult {
  valid: boolean;
  rulesRun: number;
  violations: Us1120Violation[];
  skipped: Array<{ ruleId: string; reason: string }>;
  basis: string;
}

const BASIS =
  'IRS Form 1120 guidance: EIN 9 digits; fiscal year 12 months (short years 1–366 days); ' +
  'Schedule M-1 book-tax reconciliation (M-1 line 10 = book + net permanent + net temporary); ' +
  '21% federal corporate rate for post-2017 tax years (TCJA, IRC 11(b)); NOL deduction limited ' +
  'to 80% of taxable income before the deduction for post-2017 years (IRC 172(a)(2)); ' +
  'amount owed/overpaid arithmetic per lines 34–37.';

interface Us1120Rule {
  ruleId: string;
  skip?: (r: Us1120Return) => string | undefined;
  check: (r: Us1120Return) => Us1120Violation | undefined;
}

const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;
const round2 = (n: number): number => Math.round(n * 100) / 100;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (s: string): boolean => ISO_RE.test(s) && !Number.isNaN(Date.parse(s));

const rules: Us1120Rule[] = [
  {
    ruleId: 'EIN_FORMAT',
    check: (r) =>
      /^\d{9}$/.test(r.company.ein)
        ? undefined
        : { ruleId: 'EIN_FORMAT', message: `EIN '${r.company.ein}' must be exactly 9 digits (Form 1120, page 1).` },
  },
  {
    ruleId: 'PERIOD_ISO',
    check: (r) =>
      isIso(r.period.start) && isIso(r.period.end)
        ? undefined
        : { ruleId: 'PERIOD_ISO', message: `Tax year must be ISO dates (YYYY-MM-DD): ${r.period.start} to ${r.period.end}.` },
  },
  {
    ruleId: 'PERIOD_ORDER',
    skip: (r) => (isIso(r.period.start) && isIso(r.period.end) ? undefined : 'tax year dates not ISO'),
    check: (r) =>
      r.period.start < r.period.end
        ? undefined
        : { ruleId: 'PERIOD_ORDER', message: `Tax year start ${r.period.start} must be before end ${r.period.end}.` },
  },
  {
    ruleId: 'PERIOD_LENGTH',
    skip: (r) => (isIso(r.period.start) && isIso(r.period.end) ? undefined : 'tax year dates not ISO'),
    check: (r) => {
      const days = (Date.parse(r.period.end) - Date.parse(r.period.start)) / 86_400_000;
      if (days < 1 || days > 366) {
        return {
          ruleId: 'PERIOD_LENGTH',
          message: `Tax year of ${days} days must be between 1 and 366 days — fiscal years run 12 months unless a short year is authorized.`,
        };
      }
      return undefined;
    },
  },
  {
    ruleId: 'M1_IDENTITY',
    check: (r) => {
      const expected = r.m1.bookIncome + r.m1.permanentAdjustments + r.m1.temporaryAdjustments;
      return near(round2(r.m1.taxableIncomeBeforeNol), round2(expected))
        ? undefined
        : {
            ruleId: 'M1_IDENTITY',
            message: `M-1 taxable income before NOL must equal book income + net permanent + net temporary adjustments = ${round2(expected)}; got ${round2(r.m1.taxableIncomeBeforeNol)}.`,
            line: 'M-1.10',
          };
    },
  },
  {
    ruleId: 'TCJA_RATE_ALIGNMENT',
    skip: (r) =>
      r.period.start >= '2018-01-01'
        ? undefined
        : 'tax year begins before 1 January 2018 — pre-TCJA rates not modeled',
    check: (r) =>
      near(r.rate.federalRate, 0.21)
        ? undefined
        : {
            ruleId: 'TCJA_RATE_ALIGNMENT',
            message: `Federal rate must be 21% for tax years beginning after 31 December 2017 (TCJA, IRC 11(b)); got ${r.rate.federalRate}.`,
            line: '1120.34a',
          },
  },
  {
    ruleId: 'TAX_COMPUTATION',
    check: (r) => {
      const expected = r.incomeTax.taxableIncome * r.rate.federalRate;
      return near(r.incomeTax.taxBeforeCredits, expected)
        ? undefined
        : {
            ruleId: 'TAX_COMPUTATION',
            message: `Tax before credits must equal taxable income × ${r.rate.federalRate} = ${round2(expected)}; got ${round2(r.incomeTax.taxBeforeCredits)}.`,
            line: '1120.34a',
          };
    },
  },
  {
    ruleId: 'CREDIT_LIMIT',
    check: (r) =>
      r.incomeTax.taxCredits <= r.incomeTax.taxBeforeCredits
        ? undefined
        : {
            ruleId: 'CREDIT_LIMIT',
            message: `Total credits ${round2(r.incomeTax.taxCredits)} exceed tax before credits ${round2(r.incomeTax.taxBeforeCredits)} — credits are limited to the tax liability; total tax floored at zero.`,
            line: '1120.34b',
          },
  },
  {
    ruleId: 'NOL_80_PERCENT',
    skip: (r) =>
      r.period.start >= '2018-01-01'
        ? undefined
        : 'tax year begins before 1 January 2018 — pre-TCJA NOL rules not modeled',
    check: (r) => {
      const cap = 0.8 * r.incomeTax.taxableIncomeBeforeNol;
      return r.incomeTax.nolDeduction <= cap
        ? undefined
        : {
            ruleId: 'NOL_80_PERCENT',
            message: `NOL deduction ${round2(r.incomeTax.nolDeduction)} exceeds 80% of taxable income before the deduction ${round2(cap)} (IRC 172(a)(2)).`,
            line: '1120.31',
          };
    },
  },
  {
    ruleId: 'AMOUNT_OWED_IDENTITY',
    check: (r) =>
      near(round2(r.owed.amountOwed), round2(Math.max(0, r.incomeTax.totalTax - r.payments.totalPayments)))
        ? undefined
        : {
            ruleId: 'AMOUNT_OWED_IDENTITY',
            message: `Amount owed must equal max(0, total tax − total payments) = ${round2(Math.max(0, r.incomeTax.totalTax - r.payments.totalPayments))}; got ${round2(r.owed.amountOwed)}.`,
            line: '1120.36',
          },
  },
  {
    ruleId: 'OVERPAYMENT_IDENTITY',
    check: (r) =>
      near(round2(r.owed.overpayment), round2(Math.max(0, r.payments.totalPayments - r.incomeTax.totalTax)))
        ? undefined
        : {
            ruleId: 'OVERPAYMENT_IDENTITY',
            message: `Overpayment must equal max(0, total payments − total tax) = ${round2(Math.max(0, r.payments.totalPayments - r.incomeTax.totalTax))}; got ${round2(r.owed.overpayment)}.`,
            line: '1120.37',
          },
  },
  {
    ruleId: 'NON_NEGATIVE',
    check: (r) => {
      const amounts: Array<[string, number]> = [
        ['1120.31 NOL deduction', r.incomeTax.nolDeduction],
        ['1120.33 taxable income', r.incomeTax.taxableIncome],
        ['1120.34 tax before credits', r.incomeTax.taxBeforeCredits],
        ['1120.34b total credits', r.incomeTax.taxCredits],
        ['1120.34 total tax', r.incomeTax.totalTax],
        ['1120.35 total payments', r.payments.totalPayments],
        ['1120.36 amount owed', r.owed.amountOwed],
        ['1120.37 overpayment', r.owed.overpayment],
      ];
      for (const [label, value] of amounts) {
        if (value < 0) {
          return { ruleId: 'NON_NEGATIVE', message: `${label} must not be negative; got ${value}.` };
        }
      }
      return undefined;
    },
  },
  {
    ruleId: 'RND_CREDIT_25_CAP',
    skip: () =>
      'requires a credit-type breakdown (R&D credit vs foreign tax credit) not present in this export — ' +
      'post-2022 R&D credit is limited to 25% of regular tax liability exceeding $25,000 (IRC 41(a))',
    check: () => undefined,
  },
];

export function validateUs1120Return(us1120: Us1120Return): Us1120ValidationResult {
  const violations: Us1120Violation[] = [];
  const skipped: Array<{ ruleId: string; reason: string }> = [];
  let rulesRun = 0;

  for (const rule of rules) {
    const skipReason = rule.skip?.(us1120);
    if (skipReason) {
      skipped.push({ ruleId: rule.ruleId, reason: skipReason });
      continue;
    }
    rulesRun++;
    const violation = rule.check(us1120);
    if (violation) violations.push(violation);
  }

  return { valid: violations.length === 0, rulesRun, violations, skipped, basis: BASIS };
}
