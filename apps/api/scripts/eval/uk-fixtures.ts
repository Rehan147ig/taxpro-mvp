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
    standard: 'FRS 102',
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
