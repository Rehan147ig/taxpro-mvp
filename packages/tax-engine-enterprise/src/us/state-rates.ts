// ── US State Corporate Income Tax Reference Table — 50 states + DC ──
//
// SNAPSHOT BASIS: Tax Foundation, "State Corporate Income Tax Rates and
// Brackets, 2026" (published 2026-01-05, updated 2026-04-02) —
// https://taxfoundation.org/data/all/state/state-corporate-income-tax-rates-brackets/
// Cross-checked against the Federation of Tax Administrators corporate rate
// tables and state statutes/forms/instructions via Bloomberg Tax (as cited by
// Tax Foundation). Apportionment formulas follow Tax Foundation TaxEDU,
// "State Primary Apportionment Factors for Tax Year 2026" —
// https://taxfoundation.org/taxedu/glossary/apportionment/ (captured 2026-08-03).
// This is a dated snapshot of the 2026 tax year, NOT a statement of current
// law — state rates change frequently (2026 itself saw Nebraska, North
// Carolina and Pennsylvania reduce rates; Kansas moved to a graduated 4%/7%
// structure in 2024; NE cuts further to 3.99% in 2027 subject to revenue).
// Re-verify against the latest source before any use; the `docs`
// provenance in `external-snapshots.ts` records the source of each
// dated snapshot for exactly this purpose.
//
// Naming conventions used here:
//   - apportionment: the standard formula weighting; "single sales" = 100%
//     sales factor; "equal" = 1/3 payroll/property/sales; "sales-weighted" =
//     a formula dominated by sales.
//   - rate: top marginal CIT rate for tax year 2026. Gross-receipts/margin/
//     franchise taxes are flagged separately where a state substitutes them
//     for (or adds them to) a CIT.
//
// Structural notes (2026 snapshot):
//   - No CIT at all: SD, WY. Gross-receipts SUBSTITUTES: OH (commercial
//     activity tax), TX (margin tax), WA (B&O), NV (commerce tax).
//   - Gross-receipts taxes IN ADDITION to a CIT: DE, OR, TN (state level);
//     PA, VA, WV permit local-level gross receipts taxes.
//   - NJ rates apply to the corporation's ENTIRE net income (not just the
//     amount above the bracket threshold).
//   - CT: 10% surtax on tax liability when gross proceeds ≥ $100M or filing
//     combined unitary (extended; expires 2029-01-01).

export interface StateTaxReference {
  stateCode: string;
  stateName: string;
  /** Top marginal corporate income tax rate, tax year 2026 (fraction). */
  topRate: number;
  /** Rate structure notes for tax year 2026. */
  rateNotes: string;
  /** Apportionment formula shape as commonly published (VERIFY). */
  apportionment: string;
  /** Citation pointer — the code/statute section to verify. */
  cite: string;
}

/** 2026 snapshot reference data (Tax Foundation, 2026-04-02). VERIFY every row against current state law. */
export const STATE_TAX_REFERENCE: readonly StateTaxReference[] = [
  { stateCode: 'AL', stateName: 'Alabama', topRate: 0.065, rateNotes: 'flat 6.5%', apportionment: 'single sales (verify)', cite: 'Ala. Code §40-27-1' },
  { stateCode: 'AK', stateName: 'Alaska', topRate: 0.094, rateNotes: 'graduated 0–9.4% (10 brackets; top above $222,000)', apportionment: 'equal three-factor (verify)', cite: 'AS §43.20.011' },
  { stateCode: 'AZ', stateName: 'Arizona', topRate: 0.049, rateNotes: 'flat 4.9%', apportionment: 'single sales (verify)', cite: 'A.R.S. §43-1101' },
  { stateCode: 'AR', stateName: 'Arkansas', topRate: 0.043, rateNotes: 'graduated 1–4.3% (top above $11,000)', apportionment: 'single sales (verify)', cite: 'Ark. Code §26-51-208' },
  { stateCode: 'CA', stateName: 'California', topRate: 0.0884, rateNotes: 'flat 8.84%', apportionment: 'single sales (most taxpayers; verify)', cite: 'Cal. Rev. & Tax Code §25128.7' },
  { stateCode: 'CO', stateName: 'Colorado', topRate: 0.044, rateNotes: 'flat 4.4% (may reduce midyear subject to revenue)', apportionment: 'single sales (verify)', cite: 'C.R.S. §39-22-301' },
  { stateCode: 'CT', stateName: 'Connecticut', topRate: 0.0825, rateNotes: '7.5% up to $100M, 8.25% above; 10% surtax (expires 2029-01-01)', apportionment: 'single sales (verify)', cite: 'Conn. Gen. Stat. §12-214' },
  { stateCode: 'DE', stateName: 'Delaware', topRate: 0.087, rateNotes: 'flat 8.7% (plus gross receipts licensing tax)', apportionment: 'single sales (verify)', cite: '30 Del. C. §1902' },
  { stateCode: 'FL', stateName: 'Florida', topRate: 0.055, rateNotes: 'flat 5.5% (first $50,000 exempt)', apportionment: 'double-weighted sales (verify)', cite: 'Fla. Stat. §220.11' },
  { stateCode: 'GA', stateName: 'Georgia', topRate: 0.0519, rateNotes: 'flat 5.19%', apportionment: 'single sales (verify)', cite: 'O.C.G.A. §48-7-20' },
  { stateCode: 'HI', stateName: 'Hawaii', topRate: 0.064, rateNotes: 'graduated 4.4–6.4% (top above $100,000)', apportionment: 'equal three-factor (verify)', cite: 'HRS §235-71' },
  { stateCode: 'ID', stateName: 'Idaho', topRate: 0.053, rateNotes: 'flat 5.3%', apportionment: 'single sales (verify)', cite: 'Idaho Code §63-1304' },
  { stateCode: 'IL', stateName: 'Illinois', topRate: 0.095, rateNotes: 'flat 9.5% (7% + 2.5% replacement surcharge)', apportionment: 'single sales (verify)', cite: '35 ILCS 5/201' },
  { stateCode: 'IN', stateName: 'Indiana', topRate: 0.049, rateNotes: 'flat 4.9%', apportionment: 'single sales (verify)', cite: 'IC 6-3-2-1' },
  { stateCode: 'IA', stateName: 'Iowa', topRate: 0.071, rateNotes: 'graduated 5.5–7.1% (top above $100,000)', apportionment: 'single sales (verify)', cite: 'Iowa Code §422.33' },
  { stateCode: 'KS', stateName: 'Kansas', topRate: 0.07, rateNotes: 'graduated 4% up to $50,000, 7% above', apportionment: 'equal three-factor (verify; SSF enacted 2024 — confirm effective date)', cite: 'K.S.A. §79-32-110' },
  { stateCode: 'KY', stateName: 'Kentucky', topRate: 0.05, rateNotes: 'flat 5%', apportionment: 'single sales (verify)', cite: 'KRS §141.040' },
  { stateCode: 'LA', stateName: 'Louisiana', topRate: 0.075, rateNotes: 'graduated 5.5–7.5% (top above $150,000)', apportionment: 'single sales (verify)', cite: 'La. R.S. §47:287.61' },
  { stateCode: 'ME', stateName: 'Maine', topRate: 0.0893, rateNotes: 'graduated 3.5–8.93% (top above $3.5M)', apportionment: 'single sales (verify)', cite: '36 M.R.S. §5200' },
  { stateCode: 'MD', stateName: 'Maryland', topRate: 0.0825, rateNotes: 'flat 8.25% (including local add-on)', apportionment: 'single sales (verify)', cite: 'Md. Code, Tax-Gen. §8-201' },
  { stateCode: 'MA', stateName: 'Massachusetts', topRate: 0.08, rateNotes: 'flat 8%', apportionment: 'single sales (verify)', cite: 'M.G.L. c.63 §32' },
  { stateCode: 'MI', stateName: 'Michigan', topRate: 0.06, rateNotes: 'CIT flat 6%', apportionment: 'single sales (verify)', cite: 'MCL §206.621' },
  { stateCode: 'MN', stateName: 'Minnesota', topRate: 0.098, rateNotes: 'flat 9.8%', apportionment: 'single sales (verify)', cite: 'Minn. Stat. §290.06' },
  { stateCode: 'MS', stateName: 'Mississippi', topRate: 0.05, rateNotes: 'graduated 4% above $5,000, 5% above $10,000', apportionment: 'single sales (verify)', cite: 'Miss. Code §27-7-5' },
  { stateCode: 'MO', stateName: 'Missouri', topRate: 0.04, rateNotes: 'flat 4%', apportionment: 'single sales (verify)', cite: 'Mo. Rev. Stat. §143.071' },
  { stateCode: 'MT', stateName: 'Montana', topRate: 0.0675, rateNotes: 'flat 6.75%', apportionment: 'single sales (verify)', cite: 'MCA §15-31-101' },
  { stateCode: 'NE', stateName: 'Nebraska', topRate: 0.0455, rateNotes: 'flat 4.55% (reduced 2026-01-01; 3.99% scheduled 2027 subject to revenue)', apportionment: 'single sales (verify)', cite: 'Neb. Rev. Stat. §77-2734.04' },
  { stateCode: 'NV', stateName: 'Nevada', topRate: 0, rateNotes: 'NO CIT — gross receipts commerce tax', apportionment: 'not applicable', cite: 'NRS 363C' },
  { stateCode: 'NH', stateName: 'New Hampshire', topRate: 0.075, rateNotes: 'BPT flat 7.5%', apportionment: 'single sales (verify)', cite: 'RSA §77-A:5' },
  { stateCode: 'NJ', stateName: 'New Jersey', topRate: 0.115, rateNotes: 'graduated 6.5–11.5%; rates apply to ENTIRE net income', apportionment: 'single sales (verify)', cite: 'N.J.S.A. 54:10A-5' },
  { stateCode: 'NM', stateName: 'New Mexico', topRate: 0.059, rateNotes: 'flat 5.9%', apportionment: 'equal three-factor (verify)', cite: 'NMSA §7-2A-4' },
  { stateCode: 'NY', stateName: 'New York', topRate: 0.0725, rateNotes: 'graduated 6.5% up to $5M, 7.25% above (plus MTA surcharge when applicable)', apportionment: 'single sales (verify)', cite: 'NY Tax Law §210-A' },
  { stateCode: 'NC', stateName: 'North Carolina', topRate: 0.02, rateNotes: 'flat 2% (reduced 2026-01-01; scheduled to 0% by 2030)', apportionment: 'single sales (verify)', cite: 'N.C. Gen. Stat. §105-130.3' },
  { stateCode: 'ND', stateName: 'North Dakota', topRate: 0.0431, rateNotes: 'graduated 1.41–4.31% (top above $50,000)', apportionment: 'equal three-factor (verify)', cite: 'N.D.C.C. §57-38-30' },
  { stateCode: 'OH', stateName: 'Ohio', topRate: 0, rateNotes: 'NO CIT — commercial activity tax (gross receipts)', apportionment: 'not applicable (CAT is gross receipts)', cite: 'ORC §5751.02' },
  { stateCode: 'OK', stateName: 'Oklahoma', topRate: 0.04, rateNotes: 'flat 4%', apportionment: 'equal three-factor (verify; single-sales election available)', cite: '68 O.S. §2355' },
  { stateCode: 'OR', stateName: 'Oregon', topRate: 0.076, rateNotes: 'graduated 6.6% up to $1M, 7.6% above (plus gross receipts tax)', apportionment: 'single sales (verify)', cite: 'ORS §317.061' },
  { stateCode: 'PA', stateName: 'Pennsylvania', topRate: 0.0749, rateNotes: 'flat 7.49% (reduced 2026-01-01; phased to 4.99% by 2031)', apportionment: 'single sales (verify)', cite: '72 P.S. §7401' },
  { stateCode: 'RI', stateName: 'Rhode Island', topRate: 0.07, rateNotes: 'flat 7%', apportionment: 'single sales (verify)', cite: 'R.I. Gen. Laws §44-11-2' },
  { stateCode: 'SC', stateName: 'South Carolina', topRate: 0.05, rateNotes: 'flat 5%', apportionment: 'single sales (verify)', cite: 'S.C. Code §12-6-530' },
  { stateCode: 'SD', stateName: 'South Dakota', topRate: 0, rateNotes: 'NO corporate income tax', apportionment: 'not applicable', cite: 'SDCL Ch. 10-43' },
  { stateCode: 'TN', stateName: 'Tennessee', topRate: 0.065, rateNotes: 'flat 6.5% (excise tax; plus franchise tax)', apportionment: 'single sales (verify)', cite: 'Tenn. Code §67-4-2006' },
  { stateCode: 'TX', stateName: 'Texas', topRate: 0, rateNotes: 'NO CIT — franchise margin tax (up to 0.75% margin)', apportionment: 'not applicable (margin tax is gross-margin based)', cite: 'Tex. Tax Code Ch. 171' },
  { stateCode: 'UT', stateName: 'Utah', topRate: 0.045, rateNotes: 'flat 4.5%', apportionment: 'single sales (verify)', cite: 'Utah Code §59-7-104' },
  { stateCode: 'VT', stateName: 'Vermont', topRate: 0.085, rateNotes: 'graduated 6% up to $10,000, 7% to $25,000, 8.5% above', apportionment: 'single sales (verify)', cite: '32 V.S.A. §5832' },
  { stateCode: 'VA', stateName: 'Virginia', topRate: 0.06, rateNotes: 'flat 6%', apportionment: 'double-weighted sales (verify)', cite: 'Va. Code §58.1-320' },
  { stateCode: 'WA', stateName: 'Washington', topRate: 0, rateNotes: 'NO CIT — gross receipts B&O tax', apportionment: 'not applicable (B&O is apportioned by receipts)', cite: 'RCW 82.04.020' },
  { stateCode: 'WV', stateName: 'West Virginia', topRate: 0.065, rateNotes: 'flat 6.5%', apportionment: 'single sales (verify)', cite: 'W. Va. Code §11-24-7' },
  { stateCode: 'WI', stateName: 'Wisconsin', topRate: 0.079, rateNotes: 'flat 7.9%', apportionment: 'single sales (verify)', cite: 'Wis. Stat. §71.25' },
  { stateCode: 'WY', stateName: 'Wyoming', topRate: 0, rateNotes: 'NO corporate income tax', apportionment: 'not applicable', cite: 'W.S. §39-14' },
  { stateCode: 'DC', stateName: 'District of Columbia', topRate: 0.0825, rateNotes: 'flat 8.25%', apportionment: 'single sales (verify)', cite: 'D.C. Code §47-1810.03' },
] as const;

const INDEX = new Map(STATE_TAX_REFERENCE.map(s => [s.stateCode, s]));

/**
 * Looks up the reference row for a state code. Returns undefined for unknown
 * codes. Reference data only — always verify against current law.
 */
export function stateTaxReference(stateCode: string): StateTaxReference | undefined {
  return INDEX.get(stateCode.toUpperCase());
}
