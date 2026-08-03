// ── Dated external-data snapshots used to verify STATE_RULESET ──
//
// Every snapshot records WHERE the data came from, WHEN it was published, and
// WHEN we captured it. The verifier (`verify-rates.ts`) diffs the live
// ruleset against these dated snapshots; when a state changes its rate,
// structure, or apportionment weights, the snapshot must be re-fetched and
// updated here BEFORE the ruleset changes — otherwise the verification test
// fails. This makes stale tax data a failing CI test instead of a silent
// miscomputation.

export interface ExternalSource {
  /** Short human name of the source. */
  name: string;
  /** Page or document title. */
  title: string;
  /** Stable URL of the source. */
  url: string;
  /** Publication date of the source edition used. */
  publishedAt: string;
  /** Date we captured/verified the data. */
  fetchedAt: string;
  /** Tax year the snapshot describes. */
  taxYear: number;
}

export type SnapshotScheduleKind = 'flat' | 'bracketed';
export type SnapshotFilingType = 'cit' | 'grossReceipts' | 'none';

/**
 * Apportionment weights as captured from the source. `null` means the
 * jurisdiction levies no corporate income tax (weights not applicable).
 * Sum to 1 when present.
 */
export type SnapshotWeights = { payroll: number; property: number; sales: number } | null;

export interface SnapshotRow {
  stateCode: string;
  /** Top marginal rate for the tax year, as a fraction. */
  topRate: number;
  scheduleKind: SnapshotScheduleKind;
  filingType: SnapshotFilingType;
  /** Primary apportionment formula weights for the tax year. */
  weights: SnapshotWeights;
}

const S: SnapshotWeights = { payroll: 0, property: 0, sales: 1 };
const E: SnapshotWeights = { payroll: 1 / 3, property: 1 / 3, sales: 1 / 3 };
const D: SnapshotWeights = { payroll: 0.25, property: 0.25, sales: 0.5 };
const NA: SnapshotWeights = null;

/**
 * 2026 corporate income tax rates and structures for all 50 states + DC,
 * captured from the Tax Foundation "State Corporate Income Tax Rates and
 * Brackets, 2026" table (page updated 2026-04-02).
 */
export const TF_2026_RATES: ExternalSource = {
  name: 'Tax Foundation',
  title: 'State Corporate Income Tax Rates and Brackets, 2026',
  url: 'https://taxfoundation.org/data/all/state/state-corporate-income-tax-rates-brackets/',
  publishedAt: '2026-01-05',
  fetchedAt: '2026-04-02',
  taxYear: 2026,
};

/**
 * 2026 primary apportionment formulas for all 50 states + DC, captured from
 * the Tax Foundation TaxEDU glossary "State Primary Apportionment Factors for
 * Tax Year 2026" table.
 */
export const TF_2026_APPORTIONMENT: ExternalSource = {
  name: 'Tax Foundation TaxEDU',
  title: 'State Primary Apportionment Factors for Tax Year 2026',
  url: 'https://taxfoundation.org/taxedu/glossary/apportionment/',
  publishedAt: '2020-07-27',
  fetchedAt: '2026-08-03',
  taxYear: 2026,
};

/**
 * The snapshot: 51 rows, one per jurisdiction. This is the machine-readable
 * capture of TF_2026_RATES + TF_2026_APPORTIONMENT used by the verifier.
 * When re-fetching, update the `fetchedAt` of the affected source AND any
 * changed rows here.
 *
 * Weights legend: S = single sales factor, E = equal three-factor,
 * D = double-weighted sales, NA = no CIT. KS: TaxEDU lists three-factor for
 * tax year 2026, but Kansas enacted single-sales-factor apportionment in 2024
 * — confirm the effective date (flagged on the ruleset).
 */
export const SNAPSHOT_2026: {
  rateSource: ExternalSource;
  weightSource: ExternalSource;
  rows: readonly SnapshotRow[];
} = {
  rateSource: TF_2026_RATES,
  weightSource: TF_2026_APPORTIONMENT,
  rows: [
    { stateCode: 'AL', topRate: 0.065, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'AK', topRate: 0.094, scheduleKind: 'bracketed', filingType: 'cit', weights: E },
    { stateCode: 'AZ', topRate: 0.049, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'AR', topRate: 0.043, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'CA', topRate: 0.0884, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'CO', topRate: 0.044, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'CT', topRate: 0.0825, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'DE', topRate: 0.087, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'FL', topRate: 0.055, scheduleKind: 'flat', filingType: 'cit', weights: D },
    { stateCode: 'GA', topRate: 0.0519, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'HI', topRate: 0.064, scheduleKind: 'bracketed', filingType: 'cit', weights: E },
    { stateCode: 'ID', topRate: 0.053, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'IL', topRate: 0.095, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'IN', topRate: 0.049, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'IA', topRate: 0.071, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'KS', topRate: 0.07, scheduleKind: 'bracketed', filingType: 'cit', weights: E },
    { stateCode: 'KY', topRate: 0.05, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'LA', topRate: 0.075, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'ME', topRate: 0.0893, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'MD', topRate: 0.0825, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'MA', topRate: 0.08, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'MI', topRate: 0.06, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'MN', topRate: 0.098, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'MS', topRate: 0.05, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'MO', topRate: 0.04, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'MT', topRate: 0.0675, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'NE', topRate: 0.0455, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'NV', topRate: 0, scheduleKind: 'flat', filingType: 'grossReceipts', weights: NA },
    { stateCode: 'NH', topRate: 0.075, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'NJ', topRate: 0.115, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'NM', topRate: 0.059, scheduleKind: 'flat', filingType: 'cit', weights: E },
    { stateCode: 'NY', topRate: 0.0725, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'NC', topRate: 0.02, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'ND', topRate: 0.0431, scheduleKind: 'bracketed', filingType: 'cit', weights: E },
    { stateCode: 'OH', topRate: 0, scheduleKind: 'flat', filingType: 'grossReceipts', weights: NA },
    { stateCode: 'OK', topRate: 0.04, scheduleKind: 'flat', filingType: 'cit', weights: E },
    { stateCode: 'OR', topRate: 0.076, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'PA', topRate: 0.0749, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'RI', topRate: 0.07, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'SC', topRate: 0.05, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'SD', topRate: 0, scheduleKind: 'flat', filingType: 'none', weights: NA },
    { stateCode: 'TN', topRate: 0.065, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'TX', topRate: 0, scheduleKind: 'flat', filingType: 'grossReceipts', weights: NA },
    { stateCode: 'UT', topRate: 0.045, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'VT', topRate: 0.085, scheduleKind: 'bracketed', filingType: 'cit', weights: S },
    { stateCode: 'VA', topRate: 0.06, scheduleKind: 'flat', filingType: 'cit', weights: D },
    { stateCode: 'WA', topRate: 0, scheduleKind: 'flat', filingType: 'grossReceipts', weights: NA },
    { stateCode: 'WV', topRate: 0.065, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'WI', topRate: 0.079, scheduleKind: 'flat', filingType: 'cit', weights: S },
    { stateCode: 'WY', topRate: 0, scheduleKind: 'flat', filingType: 'none', weights: NA },
    { stateCode: 'DC', topRate: 0.0825, scheduleKind: 'flat', filingType: 'cit', weights: S },
  ],
};

/** Every dated snapshot of external reference data (in chronological order). */
export const EXTERNAL_SNAPSHOTS = [SNAPSHOT_2026] as const;
