// ── Tax constants and rate tables ──
import Decimal from 'decimal.js';
import type { TaxRate } from './types.js';

type DecimalInstance = InstanceType<typeof Decimal>;

export const US_FEDERAL_CORP_RATE: TaxRate = new Decimal('0.21');

export const STATE_CORP_RATES: Record<string, TaxRate> = {
  AL: new Decimal('0.065'), AK: new Decimal('0.00'), AZ: new Decimal('0.049'),
  AR: new Decimal('0.038'), CA: new Decimal('0.0884'), CO: new Decimal('0.0440'),
  CT: new Decimal('0.075'), DE: new Decimal('0.087'), FL: new Decimal('0.055'),
  GA: new Decimal('0.057'), HI: new Decimal('0.064'), ID: new Decimal('0.058'),
  IL: new Decimal('0.095'), IN: new Decimal('0.047'), IA: new Decimal('0.079'),
  KS: new Decimal('0.040'), KY: new Decimal('0.050'), LA: new Decimal('0.075'),
  ME: new Decimal('0.087'), MD: new Decimal('0.085'), MA: new Decimal('0.080'),
  MI: new Decimal('0.060'), MN: new Decimal('0.098'), MS: new Decimal('0.050'),
  MO: new Decimal('0.040'), MT: new Decimal('0.0675'), NE: new Decimal('0.0781'),
  NV: new Decimal('0.00'), NH: new Decimal('0.075'), NJ: new Decimal('0.115'),
  NM: new Decimal('0.075'), NY: new Decimal('0.071'), NC: new Decimal('0.025'),
  ND: new Decimal('0.0465'), OH: new Decimal('0.00'), OK: new Decimal('0.040'),
  OR: new Decimal('0.076'), PA: new Decimal('0.0999'), RI: new Decimal('0.07'),
  SC: new Decimal('0.05'), SD: new Decimal('0.00'), TN: new Decimal('0.065'),
  TX: new Decimal('0.00'), UT: new Decimal('0.0485'), VT: new Decimal('0.081'),
  VA: new Decimal('0.06'), WA: new Decimal('0.00'), WV: new Decimal('0.065'),
  WI: new Decimal('0.079'), WY: new Decimal('0.00'),
};

export const DEFAULT_STATE_APPORTIONMENT = new Decimal('0.15');

// ── MACRS Depreciation Tables ──
// MACRS half-year convention rates by recovery period and year.
// These are the official IRS-published percentages.
export const MACRS_TABLES: Record<string, Record<number, DecimalInstance>> = {
  '3-year': {
    1: new Decimal('0.3333'), 2: new Decimal('0.4445'),
    3: new Decimal('0.1481'), 4: new Decimal('0.0741'),
  },
  '5-year': {
    1: new Decimal('0.2000'), 2: new Decimal('0.3200'),
    3: new Decimal('0.1920'), 4: new Decimal('0.1152'),
    5: new Decimal('0.1152'), 6: new Decimal('0.0576'),
  },
  '7-year': {
    1: new Decimal('0.1429'), 2: new Decimal('0.2449'),
    3: new Decimal('0.1749'), 4: new Decimal('0.1249'),
    5: new Decimal('0.0893'), 6: new Decimal('0.0892'),
    7: new Decimal('0.0893'), 8: new Decimal('0.0446'),
  },
  '10-year': {
    1: new Decimal('0.1000'), 2: new Decimal('0.1800'),
    3: new Decimal('0.1440'), 4: new Decimal('0.1152'),
    5: new Decimal('0.0922'), 6: new Decimal('0.0737'),
    7: new Decimal('0.0655'), 8: new Decimal('0.0655'),
    9: new Decimal('0.0656'), 10: new Decimal('0.0655'),
    11: new Decimal('0.0328'),
  },
  '15-year': {
    1: new Decimal('0.0500'), 2: new Decimal('0.0950'),
    3: new Decimal('0.0855'), 4: new Decimal('0.0770'),
    5: new Decimal('0.0693'), 6: new Decimal('0.0623'),
    7: new Decimal('0.0590'), 8: new Decimal('0.0590'),
    9: new Decimal('0.0591'), 10: new Decimal('0.0590'),
    11: new Decimal('0.0591'), 12: new Decimal('0.0590'),
    13: new Decimal('0.0591'), 14: new Decimal('0.0590'),
    15: new Decimal('0.0591'), 16: new Decimal('0.0295'),
  },
  '20-year': {
    1: new Decimal('0.0375'), 2: new Decimal('0.0719'),
    3: new Decimal('0.0668'), 4: new Decimal('0.0618'),
    5: new Decimal('0.0571'), 6: new Decimal('0.0528'),
    7: new Decimal('0.0488'), 8: new Decimal('0.0452'),
    9: new Decimal('0.0447'), 10: new Decimal('0.0447'),
    11: new Decimal('0.0447'), 12: new Decimal('0.0447'),
    13: new Decimal('0.0448'), 14: new Decimal('0.0447'),
    15: new Decimal('0.0448'), 16: new Decimal('0.0447'),
    17: new Decimal('0.0448'), 18: new Decimal('0.0447'),
    19: new Decimal('0.0448'), 20: new Decimal('0.0447'),
    21: new Decimal('0.0223'),
  },
};

export const MACRS_LIFE_MAP: Record<string, string> = {
  TEMP_DEPRECIATION: '5-year',
  TEMP_ACCELERATED_DEPRECIATION: '5-year',
  TEMP_BONUS_DEPRECIATION: '5-year',
  TEMP_SECTION_179: '5-year',
  TEMP_AMORTIZATION: '15-year',
};

export const SECTION_179_LIMIT = new Decimal('1160000');
export const BONUS_DEPRECIATION_RATE = new Decimal('0.80');

// §382 annual limitation (approximate — real calc depends on ownership change)
export const NOL_SEC_382_LIMIT_FRACTION = new Decimal('0.80');

// Default timing factors for non-depreciation categories
export const DEFAULT_TIMING_FACTORS: Record<string, DecimalInstance> = {
  TEMP_BAD_DEBT_RESERVE: new Decimal('0.15'),
  TEMP_INVENTORY_RESERVE: new Decimal('0.10'),
  TEMP_WARRANTY_RESERVE: new Decimal('0.50'),
  TEMP_DEFERRED_REVENUE: new Decimal('0.40'),
  TEMP_ACCRUED_LIABILITIES: new Decimal('0.30'),
  TEMP_OTHER: new Decimal('0.10'),
};

export const REVERSAL_PERIOD_MAP: Record<string, number> = {
  TEMP_DEPRECIATION: 5,
  TEMP_ACCELERATED_DEPRECIATION: 3,
  TEMP_BONUS_DEPRECIATION: 1,
  TEMP_SECTION_179: 1,
  TEMP_AMORTIZATION: 15,
  TEMP_BAD_DEBT_RESERVE: 1,
  TEMP_WARRANTY_RESERVE: 2,
  TEMP_DEFERRED_REVENUE: 1,
  TEMP_ACCRUED_LIABILITIES: 1,
  TEMP_OTHER: 3,
};
