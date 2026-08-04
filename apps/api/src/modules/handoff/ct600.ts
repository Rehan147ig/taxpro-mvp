// ─────────────────────────────────────────────────────────────────────────────
// Phase D — Handoff CT600 builder (band-correct).
//
// The shared ct600FromProvisionDetail reports the whole charge in Box 12
// (main rate), which fails the CT600 band-alignment rules for companies
// below the £50k small-profits limit or inside the marginal-relief band.
// This builder selects the correct band from the engine's deterministic
// figures so the CT600 artefact shipped in the filing package validates
// clean: small profits rate → Box 13, main rate → Box 12, marginal relief
// → Box 14, exactly one band populated.
//
// generatedAt is passed in (from immutable run data) so the artefact is
// byte-identical across exports of the same locked run.
// ─────────────────────────────────────────────────────────────────────────────

import { buildCt600Return, type Ct600CompanyInfo, type Ct600Period, type Ct600Return } from '../export/ct600.js';

export const UK_SMALL_PROFITS_LIMIT = 50_000;
export const UK_UPPER_LIMIT = 250_000;
const MAIN_RATE = 0.25;
const SMALL_RATE = 0.19;

export interface HandoffCt600Detail {
  currentTax?: {
    taxableIncome?: number;
    federalTax?: number;
    marginalRelief?: number;
    taxCredits?: number;
    estimatedPayments?: number;
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildHandoffCt600(
  company: Ct600CompanyInfo,
  period: Ct600Period,
  detail: HandoffCt600Detail,
  generatedAt: string,
): Ct600Return {
  const ct = detail.currentTax ?? {};
  const taxableIncome = Number(ct.taxableIncome ?? 0);
  const charge = Number(ct.federalTax ?? 0);

  let taxAtMainRate: number;
  let taxAtSmallProfitsRate: number;
  let marginalRelief: number;

  if (taxableIncome <= UK_SMALL_PROFITS_LIMIT) {
    // Small profits regime (19%): whole charge in Box 13.
    taxAtMainRate = 0;
    taxAtSmallProfitsRate = round2(charge);
    marginalRelief = 0;
  } else if (taxableIncome < UK_UPPER_LIMIT) {
    // Marginal relief band: gross main-rate charge in Box 12, relief in Box 14.
    taxAtMainRate = round2(taxableIncome * MAIN_RATE);
    taxAtSmallProfitsRate = 0;
    marginalRelief = round2(Number(ct.marginalRelief ?? 0) || Math.max(0, taxAtMainRate - charge));
  } else {
    // Main rate (25%): whole charge in Box 12.
    taxAtMainRate = round2(charge);
    taxAtSmallProfitsRate = 0;
    marginalRelief = 0;
  }

  const built = buildCt600Return(company, period, {
    profitsChargeableToCT: round2(taxableIncome),
    taxableTotalProfits: round2(taxableIncome),
    taxAtMainRate,
    taxAtSmallProfitsRate,
    marginalRelief,
    taxCredits: Number(ct.taxCredits ?? 0),
    taxDeductedAtSource: 0,
    paymentsOnAccount: Number(ct.estimatedPayments ?? 0),
    rdSurrender: 0,
    rdec: 0,
  });

  return { ...built, generatedAt };
}

/**
 * Derived figures used by the handoff manifest and package: exactly how
 * much of the charge sits in each band. Deterministic given the detail.
 */
export function bandSummary(detail: HandoffCt600Detail): {
  taxableIncome: number;
  charge: number;
  band: 'small_profits' | 'marginal_relief' | 'main_rate' | 'loss';
  marginalRelief: number;
} {
  const ct = detail.currentTax ?? {};
  const taxableIncome = Number(ct.taxableIncome ?? 0);
  const charge = Number(ct.federalTax ?? 0);
  if (taxableIncome <= UK_SMALL_PROFITS_LIMIT) {
    return { taxableIncome: round2(taxableIncome), charge: round2(charge), band: 'small_profits', marginalRelief: 0 };
  }
  if (taxableIncome < UK_UPPER_LIMIT) {
    const gross = round2(taxableIncome * MAIN_RATE);
    return {
      taxableIncome: round2(taxableIncome),
      charge: round2(charge),
      band: 'marginal_relief',
      marginalRelief: round2(Number(ct.marginalRelief ?? 0) || Math.max(0, gross - charge)),
    };
  }
  if (taxableIncome <= 0) {
    return { taxableIncome: round2(taxableIncome), charge: 0, band: 'loss', marginalRelief: 0 };
  }
  return { taxableIncome: round2(taxableIncome), charge: round2(charge), band: 'main_rate', marginalRelief: 0 };
}

export { SMALL_RATE, MAIN_RATE };
