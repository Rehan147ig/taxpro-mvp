// ── US State Corporate Income Tax Reference Table — 50 states + DC ──
//
// UNVALIDATED — this table is REFERENCE DATA assembled from public sources
// and is NOT a statement of current law. State rates, brackets, and
// apportionment formulas change frequently (and are often indexed or
// phase-adjusted). Every entry is a snapshot to be VERIFIED against the
// state's current statute (Department of Revenue / Revenue Code) before any
// use. This table exists so validators and models can see the shape of the
// 50-state problem; it is not wired into any computation.
//
// Naming conventions used here:
//   - apportionment: the standard formula weighting; "single sales" = 100%
//     sales factor; "equal" = 1/3 payroll/property/sales; "double-weighted
//     sales" = 25/25/50; "sales-weighted" = a formula dominated by sales.
//   - rate: top marginal CIT rate as commonly published; several states
//     phase rates in by income tier. Gross-receipts/margin/franchise taxes
//     are flagged separately where a state substitutes them for (or adds
//     them to) a CIT.
//
// Known structural notes (all to be verified):
//   - No CIT at all: NV, SD, WY (no corporate income tax).
//   - Substitutes for CIT: OH (commercial activity tax, gross receipts),
//     TX (margin tax), WA (gross receipts B&O tax), plus LA/NJ/PA/NH/RI etc.
//     franchise/gross-receipts surtaxes layered on a CIT.
//   - The DC and most-state formulas now weight sales most heavily; a
//     handful of states retain equal or double-weighted sales formulas.
//   - A handful of states use a flat rate (e.g. NC); others bracket (e.g.
//     AR, MO, ND). Rates shown are the top tier.

export interface StateTaxReference {
  stateCode: string;
  stateName: string;
  /** Top marginal corporate income tax rate (fraction, e.g. 0.099). */
  topRate: number;
  /**
   * Rate structure notes: flat vs bracketed vs rate-range, plus any
   * substitute taxes (gross receipts / margin / franchise).
   */
  rateNotes: string;
  /** Apportionment formula shape as commonly published (VERIFY). */
  apportionment: string;
  /** Citation pointer — the code/statute section to verify. */
  cite: string;
}

/** Snapshot reference data. VERIFY every row against current state law. */
export const STATE_TAX_REFERENCE: readonly StateTaxReference[] = [
  { stateCode: 'AL', stateName: 'Alabama', topRate: 0.065, rateNotes: 'flat 6.5%', apportionment: 'single sales (historically three-factor; verify)', cite: 'Ala. Code §40-27-1' },
  { stateCode: 'AK', stateName: 'Alaska', topRate: 0.09, rateNotes: 'bracketed 0–9.4% (top tier)', apportionment: 'equal three-factor (verify)', cite: 'AS §43.20.011' },
  { stateCode: 'AZ', stateName: 'Arizona', topRate: 0.049, rateNotes: 'flat 4.9%', apportionment: 'single sales (verify)', cite: 'A.R.S. §43-1101' },
  { stateCode: 'AR', stateName: 'Arkansas', topRate: 0.048, rateNotes: 'bracketed, top tier 4.8%', apportionment: 'single sales (verify)', cite: 'Ark. Code §26-51-208' },
  { stateCode: 'CA', stateName: 'California', topRate: 0.0884, rateNotes: 'flat 8.84%', apportionment: 'single sales (most taxpayers; verify)', cite: 'Cal. Rev. & Tax Code §25128.7' },
  { stateCode: 'CO', stateName: 'Colorado', topRate: 0.0425, rateNotes: 'flat 4.25% (plus franchise fee)', apportionment: 'single sales (verify)', cite: 'C.R.S. §39-22-301' },
  { stateCode: 'CT', stateName: 'Connecticut', topRate: 0.075, rateNotes: '7.5% top tier (plus 10% surcharge historically; verify)', apportionment: 'single sales (verify)', cite: 'Conn. Gen. Stat. §12-214' },
  { stateCode: 'DE', stateName: 'Delaware', topRate: 0.084, rateNotes: '8.4% flat (plus gross receipts licensing)', apportionment: 'equal three-factor (verify)', cite: '30 Del. C. §1902' },
  { stateCode: 'FL', stateName: 'Florida', topRate: 0.055, rateNotes: '5.5% (rate may vary; verify)', apportionment: 'single sales (verify)', cite: 'Fla. Stat. §220.11' },
  { stateCode: 'GA', stateName: 'Georgia', topRate: 0.053, rateNotes: '5.3%', apportionment: 'single sales (verify)', cite: 'O.C.G.A. §48-7-20' },
  { stateCode: 'HI', stateName: 'Hawaii', topRate: 0.064, rateNotes: '6.4% top tier', apportionment: 'equal three-factor (verify)', cite: 'HRS §235-71' },
  { stateCode: 'ID', stateName: 'Idaho', topRate: 0.058, rateNotes: '5.8%', apportionment: 'single sales (verify)', cite: 'Idaho Code §63-1304' },
  { stateCode: 'IL', stateName: 'Illinois', topRate: 0.095, rateNotes: '7% + 2.5% replacement surcharge = 9.5%', apportionment: 'single sales (verify)', cite: '35 ILCS 5/201' },
  { stateCode: 'IN', stateName: 'Indiana', topRate: 0.047, rateNotes: 'flat 4.7% (phasing; verify)', apportionment: 'single sales (verify)', cite: 'IC 6-3-2-1' },
  { stateCode: 'IA', stateName: 'Iowa', topRate: 0.079, rateNotes: 'top tier 7.9%', apportionment: 'single sales (verify)', cite: 'Iowa Code §422.33' },
  { stateCode: 'KS', stateName: 'Kansas', topRate: 0.04, rateNotes: 'flat 4%', apportionment: 'single sales (verify)', cite: 'K.S.A. §79-32-110' },
  { stateCode: 'KY', stateName: 'Kentucky', topRate: 0.05, rateNotes: 'flat 5%', apportionment: 'single sales (verify)', cite: 'KRS §141.040' },
  { stateCode: 'LA', stateName: 'Louisiana', topRate: 0.075, rateNotes: 'top tier 7.5%', apportionment: 'single sales (verify)', cite: 'La. R.S. §47:287.61' },
  { stateCode: 'ME', stateName: 'Maine', topRate: 0.0875, rateNotes: 'top tier 8.75%', apportionment: 'single sales (verify)', cite: '36 M.R.S. §5200' },
  { stateCode: 'MD', stateName: 'Maryland', topRate: 0.0825, rateNotes: '8.25% (including local add-on)', apportionment: 'single sales (verify)', cite: 'Md. Code, Tax-Gen. §8-201' },
  { stateCode: 'MA', stateName: 'Massachusetts', topRate: 0.08, rateNotes: '8%', apportionment: 'single sales (verify)', cite: 'M.G.L. c.63 §32' },
  { stateCode: 'MI', stateName: 'Michigan', topRate: 0.06, rateNotes: 'CIT 6%', apportionment: 'single sales (verify)', cite: 'MCL §206.621' },
  { stateCode: 'MN', stateName: 'Minnesota', topRate: 0.098, rateNotes: 'top tier 9.8%', apportionment: 'single sales (verify)', cite: 'Minn. Stat. §290.06' },
  { stateCode: 'MS', stateName: 'Mississippi', topRate: 0.05, rateNotes: 'top tier 5%', apportionment: 'single sales (verify)', cite: 'Miss. Code §27-7-5' },
  { stateCode: 'MO', stateName: 'Missouri', topRate: 0.04, rateNotes: 'top tier 4%', apportionment: 'single sales (verify)', cite: 'Mo. Rev. Stat. §143.071' },
  { stateCode: 'MT', stateName: 'Montana', topRate: 0.0675, rateNotes: 'flat 6.75%', apportionment: 'equal three-factor (verify)', cite: 'MCA §15-31-101' },
  { stateCode: 'NE', stateName: 'Nebraska', topRate: 0.0758, rateNotes: 'top tier 7.58%', apportionment: 'single sales (verify)', cite: 'Neb. Rev. Stat. §77-2734.04' },
  { stateCode: 'NV', stateName: 'Nevada', topRate: 0, rateNotes: 'NO corporate income tax (gross receipts commerce tax exists)', apportionment: 'not applicable', cite: 'NRS 363C' },
  { stateCode: 'NH', stateName: 'New Hampshire', topRate: 0.075, rateNotes: 'BPT top tier 7.5%', apportionment: 'single sales (verify)', cite: 'RSA §77-A:5' },
  { stateCode: 'NJ', stateName: 'New Jersey', topRate: 0.115, rateNotes: 'top tier 11.5% (including surtax when in effect; verify)', apportionment: 'single sales (verify)', cite: 'N.J.S.A. 54:10A-5' },
  { stateCode: 'NM', stateName: 'New Mexico', topRate: 0.075, rateNotes: 'top tier 7.5%', apportionment: 'single sales (verify)', cite: 'NMSA §7-2A-4' },
  { stateCode: 'NY', stateName: 'New York', topRate: 0.075, rateNotes: 'top tier 7.5% (plus MTA surcharge; verify)', apportionment: 'single sales (verify)', cite: 'NY Tax Law §210-A' },
  { stateCode: 'NC', stateName: 'North Carolina', topRate: 0.025, rateNotes: 'flat 2.5%', apportionment: 'single sales (verify)', cite: 'N.C. Gen. Stat. §105-130.3' },
  { stateCode: 'ND', stateName: 'North Dakota', topRate: 0.0429, rateNotes: 'top tier 4.29%', apportionment: 'single sales (verify)', cite: 'N.D.C.C. §57-38-30' },
  { stateCode: 'OH', stateName: 'Ohio', topRate: 0, rateNotes: 'NO CIT — commercial activity tax (gross receipts)', apportionment: 'not applicable (CAT is gross receipts)', cite: 'ORC §5751.02' },
  { stateCode: 'OK', stateName: 'Oklahoma', topRate: 0.06, rateNotes: 'top tier 6%', apportionment: 'single sales (verify)', cite: '68 O.S. §2355' },
  { stateCode: 'OR', stateName: 'Oregon', topRate: 0.0799, rateNotes: 'top tier 7.99%', apportionment: 'single sales (verify)', cite: 'ORS §317.061' },
  { stateCode: 'PA', stateName: 'Pennsylvania', topRate: 0.0899, rateNotes: 'flat 8.99%', apportionment: 'single sales (verify)', cite: '72 P.S. §7401' },
  { stateCode: 'RI', stateName: 'Rhode Island', topRate: 0.07, rateNotes: 'top tier 7%', apportionment: 'single sales (verify)', cite: 'R.I. Gen. Laws §44-11-2' },
  { stateCode: 'SC', stateName: 'South Carolina', topRate: 0.05, rateNotes: 'flat 5%', apportionment: 'single sales (verify)', cite: 'S.C. Code §12-6-530' },
  { stateCode: 'SD', stateName: 'South Dakota', topRate: 0, rateNotes: 'NO corporate income tax', apportionment: 'not applicable', cite: 'SDCL Ch. 10-43' },
  { stateCode: 'TN', stateName: 'Tennessee', topRate: 0.065, rateNotes: 'flat 6.5% (excise tax)', apportionment: 'single sales (verify)', cite: 'Tenn. Code §67-4-2006' },
  { stateCode: 'TX', stateName: 'Texas', topRate: 0, rateNotes: 'NO CIT — franchise margin tax (up to 0.75% margin)', apportionment: 'not applicable (margin tax is gross-margin based)', cite: 'Tex. Tax Code Ch. 171' },
  { stateCode: 'UT', stateName: 'Utah', topRate: 0.0485, rateNotes: 'flat 4.85%', apportionment: 'single sales (verify)', cite: 'Utah Code §59-7-104' },
  { stateCode: 'VT', stateName: 'Vermont', topRate: 0.089, rateNotes: 'top tier 8.9%', apportionment: 'single sales (verify)', cite: '32 V.S.A. §5832' },
  { stateCode: 'VA', stateName: 'Virginia', topRate: 0.06, rateNotes: 'flat 6%', apportionment: 'single sales (verify)', cite: 'Va. Code §58.1-320' },
  { stateCode: 'WA', stateName: 'Washington', topRate: 0, rateNotes: 'NO CIT — gross receipts B&O tax', apportionment: 'not applicable (B&O is apportioned by receipts)', cite: 'RCW 82.04.020' },
  { stateCode: 'WV', stateName: 'West Virginia', topRate: 0.065, rateNotes: 'top tier 6.5%', apportionment: 'single sales (verify)', cite: 'W. Va. Code §11-24-7' },
  { stateCode: 'WI', stateName: 'Wisconsin', topRate: 0.079, rateNotes: 'top tier 7.9%', apportionment: 'single sales (verify)', cite: 'Wis. Stat. §71.25' },
  { stateCode: 'WY', stateName: 'Wyoming', topRate: 0, rateNotes: 'NO corporate income tax', apportionment: 'not applicable', cite: 'W.S. §39-14' },
  { stateCode: 'DC', stateName: 'District of Columbia', topRate: 0.0825, rateNotes: 'top tier 8.25%', apportionment: 'single sales (verify)', cite: 'D.C. Code §47-1810.03' },
] as const;

const INDEX = new Map(STATE_TAX_REFERENCE.map(s => [s.stateCode, s]));

/**
 * Looks up the reference row for a state code. Returns undefined for unknown
 * codes. Reference data only — always verify against current law.
 */
export function stateTaxReference(stateCode: string): StateTaxReference | undefined {
  return INDEX.get(stateCode.toUpperCase());
}
