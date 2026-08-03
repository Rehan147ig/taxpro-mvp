// ── Dated external-data snapshots used to verify STATE_RULESET ──
//
// Every snapshot records WHERE the data came from, WHEN it was published, and
// WHEN we captured it. The verifier (`verify-rates.ts`) diffs the live
// ruleset against these dated snapshots; when a state changes its rate or
// structure, the snapshot must be re-fetched and updated here BEFORE the
// ruleset changes — otherwise the verification test fails. This makes stale
// tax data a failing CI test instead of a silent miscomputation.

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

export interface SnapshotRow {
  stateCode: string;
  /** Top marginal rate for the tax year, as a fraction. */
  topRate: number;
  scheduleKind: SnapshotScheduleKind;
  filingType: SnapshotFilingType;
}

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
 * The snapshot: 51 rows, one per jurisdiction. This is the machine-readable
 * capture of TF_2026_RATES used by the verifier. When re-fetching, update
 * TF_2026_RATES.fetchedAt AND any changed rows here.
 */
export const SNAPSHOT_2026: { source: ExternalSource; rows: readonly SnapshotRow[] } = {
  source: TF_2026_RATES,
  rows: [
    { stateCode: 'AL', topRate: 0.065, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'AK', topRate: 0.094, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'AZ', topRate: 0.049, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'AR', topRate: 0.043, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'CA', topRate: 0.0884, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'CO', topRate: 0.044, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'CT', topRate: 0.0825, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'DE', topRate: 0.087, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'FL', topRate: 0.055, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'GA', topRate: 0.0519, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'HI', topRate: 0.064, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'ID', topRate: 0.053, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'IL', topRate: 0.095, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'IN', topRate: 0.049, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'IA', topRate: 0.071, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'KS', topRate: 0.07, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'KY', topRate: 0.05, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'LA', topRate: 0.075, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'ME', topRate: 0.0893, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'MD', topRate: 0.0825, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'MA', topRate: 0.08, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'MI', topRate: 0.06, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'MN', topRate: 0.098, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'MS', topRate: 0.05, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'MO', topRate: 0.04, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'MT', topRate: 0.0675, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'NE', topRate: 0.0455, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'NV', topRate: 0, scheduleKind: 'flat', filingType: 'grossReceipts' },
    { stateCode: 'NH', topRate: 0.075, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'NJ', topRate: 0.115, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'NM', topRate: 0.059, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'NY', topRate: 0.0725, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'NC', topRate: 0.02, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'ND', topRate: 0.0431, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'OH', topRate: 0, scheduleKind: 'flat', filingType: 'grossReceipts' },
    { stateCode: 'OK', topRate: 0.04, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'OR', topRate: 0.076, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'PA', topRate: 0.0749, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'RI', topRate: 0.07, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'SC', topRate: 0.05, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'SD', topRate: 0, scheduleKind: 'flat', filingType: 'none' },
    { stateCode: 'TN', topRate: 0.065, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'TX', topRate: 0, scheduleKind: 'flat', filingType: 'grossReceipts' },
    { stateCode: 'UT', topRate: 0.045, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'VT', topRate: 0.085, scheduleKind: 'bracketed', filingType: 'cit' },
    { stateCode: 'VA', topRate: 0.06, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'WA', topRate: 0, scheduleKind: 'flat', filingType: 'grossReceipts' },
    { stateCode: 'WV', topRate: 0.065, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'WI', topRate: 0.079, scheduleKind: 'flat', filingType: 'cit' },
    { stateCode: 'WY', topRate: 0, scheduleKind: 'flat', filingType: 'none' },
    { stateCode: 'DC', topRate: 0.0825, scheduleKind: 'flat', filingType: 'cit' },
  ],
};

/** Every dated snapshot of external reference data (in chronological order). */
export const EXTERNAL_SNAPSHOTS = [SNAPSHOT_2026] as const;
