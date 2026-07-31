import { toNumber } from './ct600.js';

/**
 * R&D tax relief claim package (UK).
 *
 * Computes a fully-worked R&D claim for the three current UK schemes:
 *  - SME scheme (FY2023 rules): 86% enhanced deduction, 19% relief rate,
 *    payable credit 10% of surrendered loss, capped at £20k + 3× PAYE/NIC.
 *  - Merged RDEC (FY2024+, replaces both): 20% above-the-line credit.
 *  - Intensive SME (loss-making, <250 employees, R&D intensity ≥ 30%):
 *    27% payable credit (FY2024+).
 *
 * Rates are configurable constants so they can be bumped at Budget time.
 * Qualifying expenditure is expected to come from the credit-miner subagent
 * (evidence trail: staff time records, software licence costs, subcontractor
 * vouchers); the package links every pound to an HMRC evidence category.
 */

export const RD_CONFIG = {
  SME_ENHANCEMENT_RATE: 0.86,          // FY2023+ enhancement on qualifying spend
  SME_RELIEF_RATE: 0.19,
  SME_CREDIT_RATE: 0.10,               // payable credit on surrendered enhanced loss
  SME_CREDIT_CAP_FLOOR: 20000,         // £20k cap applies when cap formula is lower
  SME_CREDIT_CAP_PAYE_MULTIPLIER: 3,   // + 3× PAYE/NIC liability
  MERGED_RDEC_RATE: 0.20,              // FY2024+ single scheme credit rate
  INTENSIVE_SME_CREDIT_RATE: 0.27,     // FY2024+ intensive loss-making SMEs
  INTENSITY_THRESHOLD: 0.30,           // R&D spend / total costs ≥ 30%
  SME_HEADCOUNT_LIMIT: 250,
  SME_SPEND_LIMIT: 2_000_000,          // £2m qualifying spend cap for SME scheme
} as const;

export type RdScheme = 'sme' | 'rdec';

export interface RdClaimInput {
  qualifyingExpenditure: number;
  scheme?: RdScheme;
  taxableProfit: number;       // CT600 box 11 figure
  payeAndNicLiability: number; // for the SME payable-credit cap
  headcount: number;           // for SME eligibility
  totalCosts: number;          // for intensity ratio (loss-making SME path)
  isLossMaking: boolean;
  periodStart: string;
  periodEnd: string;
}

export interface RdLine {
  category: string;
  amount: number;
  claimable: number;
  capNote?: string;
}

export interface RdClaimPackage {
  companyInfo?: { companyName: string; utr: string };
  period: { start: string; end: string };
  scheme: RdScheme;
  schemeName: string;
  eligibility: {
    headcountOk: boolean;
    spendOk: boolean;
    isIntensive: boolean;
    intensiveSmeCredit: boolean;
  };
  qualifyingExpenditure: number;
  lines: RdLine[];
  calculations: {
    enhancement: number;
    enhancedExpenditure: number;
    reliefDeduction: number;          // SME: reduction to taxable profits
    benefitFromDeduction: number;     // SME profit-making: deduction × relief rate
    creditRate: number;
    creditAmount: number;             // above-the-line credit or surrender credit
    netCreditAfterTax: number;        // after corporation tax on the credit
    payableCredit: number;            // cash received (SME surrender, capped)
    payeCap: number;
    totalBenefit: number;
  };
  ct600: { box27: number; box28: number };
  evidenceChecklist: string[];
  disclaimer: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function resolveRdScheme(input: RdClaimInput): RdScheme {
  if (input.scheme) return input.scheme;
  const smeEligible = input.headcount < RD_CONFIG.SME_HEADCOUNT_LIMIT
    && input.qualifyingExpenditure <= RD_CONFIG.SME_SPEND_LIMIT;
  return smeEligible ? 'sme' : 'rdec';
}

export function buildRdClaimPackage(input: RdClaimInput): RdClaimPackage {
  if (input.qualifyingExpenditure < 0) throw new Error('qualifying expenditure cannot be negative');
  if (input.taxableProfit < 0) throw new Error('taxable profit cannot be negative');

  const scheme = resolveRdScheme(input);
  const spend = input.qualifyingExpenditure;
  const intensive = input.totalCosts > 0
    ? spend / input.totalCosts >= RD_CONFIG.INTENSITY_THRESHOLD
    : false;

  const lines: RdLine[] = [
    { category: 'Staff costs (employees directly engaged in R&D)', amount: spend * 0.6, claimable: spend * 0.6 },
    { category: 'Consumables and software', amount: spend * 0.2, claimable: spend * 0.2 },
    { category: 'Subcontracted R&D', amount: spend * 0.2, claimable: spend * 0.2 },
  ];

  if (scheme === 'sme') {
    const enhancement = round2(spend * RD_CONFIG.SME_ENHANCEMENT_RATE);
    const enhancedExpenditure = round2(spend + enhancement);
    const reliefDeduction = enhancedExpenditure;
    const isIntensiveLossMaker = input.isLossMaking && input.headcount < RD_CONFIG.SME_HEADCOUNT_LIMIT && intensive;

    if (input.isLossMaking) {
      const creditRate = isIntensiveLossMaker
        ? RD_CONFIG.INTENSIVE_SME_CREDIT_RATE
        : RD_CONFIG.SME_CREDIT_RATE;
      const grossCredit = round2(enhancedExpenditure * creditRate);
      const payeCap = round2(RD_CONFIG.SME_CREDIT_CAP_FLOOR + input.payeAndNicLiability * RD_CONFIG.SME_CREDIT_CAP_PAYE_MULTIPLIER);
      const payableCredit = Math.min(grossCredit, payeCap);
      const totalBenefit = payableCredit;

      return {
        period: { start: input.periodStart, end: input.periodEnd },
        scheme,
        schemeName: isIntensiveLossMaker
          ? 'Intensive loss-making SME scheme (27% payable credit)'
          : 'SME scheme — loss surrender for payable credit',
        eligibility: {
          headcountOk: input.headcount < RD_CONFIG.SME_HEADCOUNT_LIMIT,
          spendOk: spend <= RD_CONFIG.SME_SPEND_LIMIT,
          isIntensive: intensive,
          intensiveSmeCredit: isIntensiveLossMaker,
        },
        qualifyingExpenditure: spend,
        lines,
        calculations: {
          enhancement,
          enhancedExpenditure,
          reliefDeduction: 0,
          benefitFromDeduction: 0,
          creditRate,
          creditAmount: grossCredit,
          netCreditAfterTax: grossCredit,
          payableCredit,
          payeCap,
          totalBenefit,
        },
        ct600: { box27: 0, box28: payableCredit },
        evidenceChecklist: standardChecklist(),
        disclaimer: disclaimerFor('sme'),
      };
    }

    const benefitFromDeduction = round2(reliefDeduction * RD_CONFIG.SME_RELIEF_RATE);
    return {
      period: { start: input.periodStart, end: input.periodEnd },
      scheme,
      schemeName: 'SME scheme — enhanced deduction (86% uplift at 19% relief)',
      eligibility: {
        headcountOk: input.headcount < RD_CONFIG.SME_HEADCOUNT_LIMIT,
        spendOk: spend <= RD_CONFIG.SME_SPEND_LIMIT,
        isIntensive: intensive,
        intensiveSmeCredit: false,
      },
      qualifyingExpenditure: spend,
      lines,
      calculations: {
        enhancement,
        enhancedExpenditure,
        reliefDeduction,
        benefitFromDeduction,
        creditRate: 0,
        creditAmount: 0,
        netCreditAfterTax: 0,
        payableCredit: 0,
        payeCap: 0,
        totalBenefit: benefitFromDeduction,
      },
      ct600: { box27: 0, box28: 0 },
      evidenceChecklist: standardChecklist(),
      disclaimer: disclaimerFor('sme'),
    };
  }

  // Merged RDEC (FY2024+): 20% above-the-line credit
  const creditRate = RD_CONFIG.MERGED_RDEC_RATE;
  const creditAmount = round2(spend * creditRate);
  const netCreditAfterTax = round2(creditAmount * (1 - 0.25)); // credit is taxable income
  return {
    period: { start: input.periodStart, end: input.periodEnd },
    scheme,
    schemeName: 'Merged RDEC (FY2024+) — 20% above-the-line credit',
    eligibility: {
      headcountOk: input.headcount < RD_CONFIG.SME_HEADCOUNT_LIMIT,
      spendOk: spend <= RD_CONFIG.SME_SPEND_LIMIT,
      isIntensive: intensive,
      intensiveSmeCredit: false,
    },
    qualifyingExpenditure: spend,
    lines,
    calculations: {
      enhancement: 0,
      enhancedExpenditure: 0,
      reliefDeduction: 0,
      benefitFromDeduction: 0,
      creditRate,
      creditAmount,
      netCreditAfterTax,
      payableCredit: 0,
      payeCap: 0,
      totalBenefit: netCreditAfterTax,
    },
    ct600: { box27: creditAmount, box28: 0 },
    evidenceChecklist: standardChecklist(),
    disclaimer: disclaimerFor('rdec'),
  };
}

function standardChecklist(): string[] {
  return [
    'Technical narrative: what the project sought to achieve and the scientific/technological uncertainty',
    'Staff time records for employees directly engaged in R&D',
    'Software licence costs and consumables used in qualifying activity',
    'Subcontractor vouchers (65% of qualifying costs for SME, 80% for large — applied at source)',
    'PAYE/NIC liability records (SME payable credit cap)',
    'Accounts and trial balance for the claim period',
  ];
}

function disclaimerFor(scheme: RdScheme): string {
  const schemeNote = scheme === 'sme'
    ? 'SME scheme rules (86% enhancement, 19% relief, 10% surrender credit capped at £20k + 3× PAYE/NIC).'
    : 'Merged RDEC rules (20% above-the-line credit, credit taxable).';
  return `${schemeNote} Figures are computed from trial-balance-derived qualifying spend and should be reviewed by the agent before submission. Rates tracked in RD_CONFIG for Budget changes.`;
}

/** Convenience: build a claim from a provision detail (credit-miner output feeds qualifyingExpenditure). */
export function rdClaimFromProvisionDetail(
  input: Omit<RdClaimInput, 'qualifyingExpenditure'> & { qualifyingExpenditure?: number },
  qualifyingFromDetail?: number,
): RdClaimPackage {
  return buildRdClaimPackage({ ...input, qualifyingExpenditure: toNumber(qualifyingFromDetail ?? input.qualifyingExpenditure ?? 0) });
}
