/**
 * UK FRS 102 ground truth fixtures.
 *
 * Each entry corresponds to a real filed set of statutory accounts on
 * Companies House. ALL numeric/string fields are TODO placeholders.
 *
 * 🔴 IMPORTANT: Every number must come from a real filed document.
 *    Do NOT fill from memory, estimation, or hallucination.
 *    Source URLs point to the company's filing history page on the
 *    Companies House find-and-update service so figures are auditable.
 */

import type { UkTaxFootnote } from './uk-ground-truth.js';

const fixtures: UkTaxFootnote[] = [
  // Greggs plc — 52 weeks ended 28 December 2024
  // Source: Greggs plc Annual Report and Accounts 2024 (filed 2025-03-17)
  // Note 8 (Income tax expense) pp 149–150, Note 14 (Deferred tax) pp 158–159
  {
    companyName: 'Greggs plc',
    companiesHouseNumber: '00502851',
    accountingPeriodEnd: '2024-12-28',
    pretaxProfit: 203.9,
    totalTaxCharge: 50.5,
    currentTaxCharge: 33.4,
    deferredTaxCharge: 17.1,
    disclosedEffectiveRate: 0.248,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Items not taxable for tax purposes', amount: -1.8, type: 'permanent' },
      { label: 'Non-tax-deductible depreciation', amount: 1.1, type: 'permanent' },
      { label: 'Adjustment for prior years', amount: 0.2, type: 'other' },
    ],
    deferredTaxAssetClosing: 4.1,
    deferredTaxLiabilityClosing: 76.7,
    probableRecoveryNoted: true,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/00502851/filing-history',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // British Telecommunications plc — year ended 31 March 2024
  // Source: BT plc Annual Report and Financial Statements 2024 (filed 2024-06-25)
  // Note 10 (Taxation) pp 57–59, Deferred taxation pp 59–60
  // Group accounts (FRS 101/IFRS), principal trading subsidiary of BT Group plc
  {
    companyName: 'British Telecommunications plc',
    companiesHouseNumber: '01800000',
    accountingPeriodEnd: '2024-03-31',
    pretaxProfit: 1897,
    totalTaxCharge: 331,
    currentTaxCharge: 97,
    deferredTaxCharge: 234,
    disclosedEffectiveRate: 0.174,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Higher/lower taxes on non-UK profits', amount: -25, type: 'other' },
      { label: 'Net permanent differences between tax and accounting', amount: -63, type: 'permanent' },
      { label: 'Adjustments in respect of earlier years', amount: -40, type: 'other' },
      { label: 'Prior year non-UK losses used', amount: -10, type: 'other' },
      { label: 'Non-UK losses not recognised', amount: -5, type: 'other' },
    ],
    deferredTaxAssetClosing: 1048,
    deferredTaxLiabilityClosing: 1533,
    probableRecoveryNoted: true,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/01800000/filing-history',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // SOURCE: replace company name — paste figures from Companies House accounts, do not fill from memory or estimation
  {
    companyName: 'TODO',
    companiesHouseNumber: 'TODO',
    accountingPeriodEnd: 'TODO',
    pretaxProfit: 0,
    totalTaxCharge: 0,
    currentTaxCharge: 0,
    deferredTaxCharge: 0,
    disclosedEffectiveRate: 0,
    statutoryRate: 0,
    reconciliationItems: [],
    deferredTaxAssetClosing: 0,
    deferredTaxLiabilityClosing: 0,
    probableRecoveryNoted: false,
    sourceDocumentUrl: 'TODO',
  },

  // SOURCE: replace company name — paste figures from Companies House accounts, do not fill from memory or estimation
  {
    companyName: 'TODO',
    companiesHouseNumber: 'TODO',
    accountingPeriodEnd: 'TODO',
    pretaxProfit: 0,
    totalTaxCharge: 0,
    currentTaxCharge: 0,
    deferredTaxCharge: 0,
    disclosedEffectiveRate: 0,
    statutoryRate: 0,
    reconciliationItems: [],
    deferredTaxAssetClosing: 0,
    deferredTaxLiabilityClosing: 0,
    probableRecoveryNoted: false,
    sourceDocumentUrl: 'TODO',
  },

  // SOURCE: replace company name — paste figures from Companies House accounts, do not fill from memory or estimation
  {
    companyName: 'TODO',
    companiesHouseNumber: 'TODO',
    accountingPeriodEnd: 'TODO',
    pretaxProfit: 0,
    totalTaxCharge: 0,
    currentTaxCharge: 0,
    deferredTaxCharge: 0,
    disclosedEffectiveRate: 0,
    statutoryRate: 0,
    reconciliationItems: [],
    deferredTaxAssetClosing: 0,
    deferredTaxLiabilityClosing: 0,
    probableRecoveryNoted: false,
    sourceDocumentUrl: 'TODO',
  },

  // SOURCE: replace company name — paste figures from Companies House accounts, do not fill from memory or estimation
  {
    companyName: 'TODO',
    companiesHouseNumber: 'TODO',
    accountingPeriodEnd: 'TODO',
    pretaxProfit: 0,
    totalTaxCharge: 0,
    currentTaxCharge: 0,
    deferredTaxCharge: 0,
    disclosedEffectiveRate: 0,
    statutoryRate: 0,
    reconciliationItems: [],
    deferredTaxAssetClosing: 0,
    deferredTaxLiabilityClosing: 0,
    probableRecoveryNoted: false,
    sourceDocumentUrl: 'TODO',
  },

  // SOURCE: replace company name — paste figures from Companies House accounts, do not fill from memory or estimation
  {
    companyName: 'TODO',
    companiesHouseNumber: 'TODO',
    accountingPeriodEnd: 'TODO',
    pretaxProfit: 0,
    totalTaxCharge: 0,
    currentTaxCharge: 0,
    deferredTaxCharge: 0,
    disclosedEffectiveRate: 0,
    statutoryRate: 0,
    reconciliationItems: [],
    deferredTaxAssetClosing: 0,
    deferredTaxLiabilityClosing: 0,
    probableRecoveryNoted: false,
    sourceDocumentUrl: 'TODO',
  },

  // SOURCE: replace company name — paste figures from Companies House accounts, do not fill from memory or estimation
  {
    companyName: 'TODO',
    companiesHouseNumber: 'TODO',
    accountingPeriodEnd: 'TODO',
    pretaxProfit: 0,
    totalTaxCharge: 0,
    currentTaxCharge: 0,
    deferredTaxCharge: 0,
    disclosedEffectiveRate: 0,
    statutoryRate: 0,
    reconciliationItems: [],
    deferredTaxAssetClosing: 0,
    deferredTaxLiabilityClosing: 0,
    probableRecoveryNoted: false,
    sourceDocumentUrl: 'TODO',
  },
];

export default fixtures;
