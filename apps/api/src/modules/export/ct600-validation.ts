import type { Ct600Return } from './ct600.js';

/**
 * CT600 conformance validation against HMRC rules.
 *
 * Rule basis:
 *  - Marginal relief: CTA 2010 s.18D / HMRC CTM03925 — MR = F × (U − A) × (N ÷ A);
 *    for the returns this app produces A = N (no exempt distributions in the model),
 *    so MR = F × (U − A) with F = 3/200 and U = £250,000 (FY2023+).
 *  - Small profits rate 19% on profits ≤ £50,000; main rate 25% on profits ≥ £250,000
 *    (FY2023+). FY2022 and earlier: flat 19% (HMRC CTM03905 / CTM03910).
 *  - Box arithmetic: CT600 (2016+) box layout — Box 15 = Box 12 + Box 13 − Box 14,
 *    Box 19 = Box 15 − Box 16 − Box 17, Box 22 = Box 19 − Box 20.
 *
 * Honesty: this validates conformance with HMRC guidance rules, not an HMRC
 * submission. Periods straddling 1 April 2023 (or ending after 31 March 2027)
 * cannot be rate-checked from the return alone and are skipped with a reason.
 */

export interface Ct600Violation {
  ruleId: string;
  message: string;
  box?: number;
}

export interface Ct600ValidationResult {
  valid: boolean;
  rulesRun: number;
  violations: Ct600Violation[];
  skipped: Array<{ ruleId: string; reason: string }>;
  basis: string;
}

const BASIS =
  'HMRC CT600 guidance: box layout CT600 (2016+); marginal relief per CTA 2010 s.18D / CTM03925 ' +
  '(F = 3/200, U = £250,000, N = A); small profits rate 19% and main rate 25% with limits ' +
  '£50k/£250k per CTM03905/CTM03910 (FY2023+); flat 19% for FY2022 and earlier.';

interface Ct600Rule {
  ruleId: string;
  skip?: (r: Ct600Return) => string | undefined;
  check: (r: Ct600Return) => Ct600Violation | undefined;
}

const boxOf = (r: Ct600Return, n: number): number => Number(r.boxes.find(b => b.box === n)?.value ?? 0);
const boxStr = (r: Ct600Return, n: number): string => String(r.boxes.find(b => b.box === n)?.value ?? '');
const penny = (n: number): number => Math.round(n * 100);
const near = (a: number, b: number, tol = 1): boolean => Math.abs(a - b) <= tol;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (s: string): boolean => ISO_RE.test(s) && !Number.isNaN(Date.parse(s));

const LOWER_P = 5_000_000; // £50,000 lower limit, pennies
const UPPER_P = 25_000_000; // £250,000 upper limit, pennies
const MR_FRACTION = 0.015; // 3/200 per CTA 2010 s.18D / CTM03925 (FY2023+)
const RATE_MAIN = 0.25;
const RATE_SMALL = 0.19;

type Regime = 'flat2022' | 'current' | 'straddle' | 'future' | 'unknown';

function regimeOf(r: Ct600Return): Regime {
  const start = boxStr(r, 3);
  const end = boxStr(r, 4);
  if (!isIso(start) || !isIso(end)) return 'unknown';
  if (end < '2023-04-01') return 'flat2022';
  if (start >= '2023-04-01' && end < '2027-04-01') return 'current';
  if (start < '2023-04-01') return 'straddle';
  return 'future';
}

const REGIME_SKIP_REASON: Record<Exclude<Regime, 'current' | 'flat2022'>, string> = {
  straddle: 'period straddles 1 April 2023 — rate apportionment not verifiable from the return alone',
  future: 'period ends after 31 March 2027 — FY2028+ rates not locked',
  unknown: 'period dates not ISO',
};

function regimeSkip(...allowed: Regime[]): (r: Ct600Return) => string | undefined {
  return (r) => {
    const regime = regimeOf(r);
    if (allowed.includes(regime)) return undefined;
    if (regime === 'current' || regime === 'flat2022') {
      return `rule only applies in the ${regime === 'current' ? 'FY2023+ rate regime' : 'flat 19% (FY2022 and earlier) regime'} — this return uses the ${regime === 'current' ? 'flat 19%' : 'FY2023+'} regime`;
    }
    return REGIME_SKIP_REASON[regime];
  };
}

const rules: Ct600Rule[] = [
  {
    ruleId: 'UTR_FORMAT',
    check: (r) =>
      /^\d{10}$/.test(boxStr(r, 1))
        ? undefined
        : { ruleId: 'UTR_FORMAT', message: `UTR '${boxStr(r, 1)}' must be exactly 10 digits (HMRC CT600 Box 1).`, box: 1 },
  },
  {
    ruleId: 'COMPANY_NUMBER_FORMAT',
    check: (r) => {
      const ch = r.company.companiesHouseNumber;
      if (ch === undefined || ch === '') return undefined;
      return /^(?:[A-Z]{2}\d{6}|\d{8})$/.test(ch)
        ? undefined
        : { ruleId: 'COMPANY_NUMBER_FORMAT', message: `Companies House number '${ch}' must be 2 letters + 6 digits (e.g. SC123456) or 8 digits.` };
    },
  },
  {
    ruleId: 'PERIOD_ISO',
    check: (r) =>
      isIso(boxStr(r, 3)) && isIso(boxStr(r, 4))
        ? undefined
        : { ruleId: 'PERIOD_ISO', message: `Accounting period must be ISO dates (YYYY-MM-DD): ${boxStr(r, 3)} to ${boxStr(r, 4)}.`, box: 3 },
  },
  {
    ruleId: 'PERIOD_ORDER',
    skip: (r) => (isIso(boxStr(r, 3)) && isIso(boxStr(r, 4)) ? undefined : 'period dates not ISO'),
    check: (r) =>
      boxStr(r, 3) < boxStr(r, 4)
        ? undefined
        : { ruleId: 'PERIOD_ORDER', message: `Period start ${boxStr(r, 3)} must be before period end ${boxStr(r, 4)}.`, box: 4 },
  },
  {
    ruleId: 'PERIOD_LENGTH',
    skip: (r) => (isIso(boxStr(r, 3)) && isIso(boxStr(r, 4)) ? undefined : 'period dates not ISO'),
    check: (r) => {
      const days = (Date.parse(boxStr(r, 4)) - Date.parse(boxStr(r, 3))) / 86_400_000;
      if (days < 1 || days > 549) {
        return { ruleId: 'PERIOD_LENGTH', message: `Accounting period of ${days} days must be between 1 and 549 days (18 months).`, box: 4 };
      }
      return undefined;
    },
  },
  {
    ruleId: 'BOX5_EQ_BOX10',
    check: (r) =>
      boxOf(r, 5) === boxOf(r, 10)
        ? undefined
        : { ruleId: 'BOX5_EQ_BOX10', message: `Box 5 (${boxOf(r, 5)}) must equal Box 10 (${boxOf(r, 10)}) — profits chargeable to CT are the taxable total profits for the modelled company.`, box: 5 },
  },
  {
    ruleId: 'BOX11_EQ_BOX5',
    check: (r) =>
      boxOf(r, 11) === boxOf(r, 5)
        ? undefined
        : { ruleId: 'BOX11_EQ_BOX5', message: `Box 11 (${boxOf(r, 11)}) must equal Box 5 (${boxOf(r, 5)}).`, box: 11 },
  },
  {
    ruleId: 'BOX15_IDENTITY',
    check: (r) => {
      const expected = Math.max(0, penny(boxOf(r, 12)) + penny(boxOf(r, 13)) - penny(boxOf(r, 14)));
      return near(penny(boxOf(r, 15)), expected)
        ? undefined
        : { ruleId: 'BOX15_IDENTITY', message: `Box 15 must equal max(0, Box 12 + Box 13 − Box 14) = ${expected / 100}; got ${boxOf(r, 15)}.`, box: 15 };
    },
  },
  {
    ruleId: 'BOX19_IDENTITY',
    check: (r) => {
      const expected = Math.max(0, penny(boxOf(r, 15)) - penny(boxOf(r, 16)) - penny(boxOf(r, 17)));
      return near(penny(boxOf(r, 19)), expected)
        ? undefined
        : { ruleId: 'BOX19_IDENTITY', message: `Box 19 must equal max(0, Box 15 − Box 16 − Box 17) = ${expected / 100}; got ${boxOf(r, 19)}.`, box: 19 };
    },
  },
  {
    ruleId: 'BOX22_IDENTITY',
    check: (r) => {
      const expected = Math.max(0, penny(boxOf(r, 19)) - penny(boxOf(r, 20)));
      return near(penny(boxOf(r, 22)), expected)
        ? undefined
        : { ruleId: 'BOX22_IDENTITY', message: `Box 22 must equal max(0, Box 19 − Box 20) = ${expected / 100}; got ${boxOf(r, 22)}.`, box: 22 };
    },
  },
  {
    ruleId: 'NON_NEGATIVE',
    check: (r) => {
      const amountBoxes = [5, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 22, 27, 28];
      for (const n of amountBoxes) {
        if (boxOf(r, n) < 0) {
          return { ruleId: 'NON_NEGATIVE', message: `Box ${n} must not be negative; got ${boxOf(r, n)}.`, box: n };
        }
      }
      return undefined;
    },
  },
  {
    ruleId: 'BAND_SELECTION',
    check: (r) =>
      boxOf(r, 12) > 0 && boxOf(r, 13) > 0
        ? { ruleId: 'BAND_SELECTION', message: 'Both Box 12 (main rate) and Box 13 (small profits rate) are populated — a single-band company must use exactly one.', box: 12 }
        : undefined,
  },
  {
    ruleId: 'SMALL_RATE_ALIGNMENT',
    skip: regimeSkip('current'),
    check: (r) => {
      const a = penny(boxOf(r, 5));
      if (a > LOWER_P) return undefined;
      const expected = Math.round(a * RATE_SMALL);
      const mismatches: string[] = [];
      if (!near(penny(boxOf(r, 13)), expected)) mismatches.push(`Box 13 must be ${expected / 100} (${boxOf(r, 5)} × 19%)`);
      if (boxOf(r, 12) !== 0) mismatches.push(`Box 12 must be 0 below the £50,000 lower limit (got ${boxOf(r, 12)})`);
      if (boxOf(r, 14) !== 0) mismatches.push(`Box 14 must be 0 below the £50,000 lower limit (got ${boxOf(r, 14)})`);
      return mismatches.length
        ? { ruleId: 'SMALL_RATE_ALIGNMENT', message: mismatches.join('; '), box: 13 }
        : undefined;
    },
  },
  {
    ruleId: 'MAIN_RATE_ALIGNMENT',
    skip: regimeSkip('current'),
    check: (r) => {
      const a = penny(boxOf(r, 5));
      if (a < UPPER_P) return undefined;
      const expected = Math.round(a * RATE_MAIN);
      const mismatches: string[] = [];
      if (!near(penny(boxOf(r, 12)), expected)) mismatches.push(`Box 12 must be ${expected / 100} (${boxOf(r, 5)} × 25%)`);
      if (boxOf(r, 13) !== 0) mismatches.push(`Box 13 must be 0 above the £250,000 upper limit (got ${boxOf(r, 13)})`);
      if (boxOf(r, 14) !== 0) mismatches.push(`Box 14 must be 0 above the £250,000 upper limit (got ${boxOf(r, 14)})`);
      return mismatches.length
        ? { ruleId: 'MAIN_RATE_ALIGNMENT', message: mismatches.join('; '), box: 12 }
        : undefined;
    },
  },
  {
    ruleId: 'MARGINAL_RELIEF_ALIGNMENT',
    skip: regimeSkip('current'),
    check: (r) => {
      const a = penny(boxOf(r, 5));
      if (a <= LOWER_P || a >= UPPER_P) return undefined;
      const mainCharge = Math.round(a * RATE_MAIN);
      const relief = Math.round((UPPER_P - a) * MR_FRACTION); // F × (U − A) with N = A
      const mismatches: string[] = [];
      if (!near(penny(boxOf(r, 12)), mainCharge)) mismatches.push(`Box 12 must be ${mainCharge / 100} (${boxOf(r, 5)} × 25%)`);
      if (!near(penny(boxOf(r, 14)), relief)) mismatches.push(`Box 14 marginal relief must be ${relief / 100} (3/200 × (£250,000 − ${boxOf(r, 5)}))`);
      if (boxOf(r, 13) !== 0) mismatches.push(`Box 13 must be 0 in the marginal relief band (got ${boxOf(r, 13)})`);
      return mismatches.length
        ? { ruleId: 'MARGINAL_RELIEF_ALIGNMENT', message: mismatches.join('; '), box: 14 }
        : undefined;
    },
  },
  {
    ruleId: 'FLAT_RATE_ALIGNMENT',
    skip: regimeSkip('flat2022'),
    check: (r) => {
      const a = penny(boxOf(r, 5));
      const expected = Math.round(a * RATE_SMALL);
      const mismatches: string[] = [];
      if (!near(penny(boxOf(r, 12)), expected)) mismatches.push(`Box 12 must be ${expected / 100} (${boxOf(r, 5)} × 19% flat rate, FY2022 or earlier)`);
      if (boxOf(r, 13) !== 0) mismatches.push(`Box 13 must be 0 before FY2023 (got ${boxOf(r, 13)})`);
      if (boxOf(r, 14) !== 0) mismatches.push(`Box 14 must be 0 before FY2023 (got ${boxOf(r, 14)})`);
      return mismatches.length
        ? { ruleId: 'FLAT_RATE_ALIGNMENT', message: mismatches.join('; '), box: 12 }
        : undefined;
    },
  },
];

export function validateCt600Return(ct600: Ct600Return): Ct600ValidationResult {
  const violations: Ct600Violation[] = [];
  const skipped: Array<{ ruleId: string; reason: string }> = [];
  let rulesRun = 0;

  for (const rule of rules) {
    const skipReason = rule.skip?.(ct600);
    if (skipReason) {
      skipped.push({ ruleId: rule.ruleId, reason: skipReason });
      continue;
    }
    rulesRun++;
    const violation = rule.check(ct600);
    if (violation) violations.push(violation);
  }

  return { valid: violations.length === 0, rulesRun, violations, skipped, basis: BASIS };
}
