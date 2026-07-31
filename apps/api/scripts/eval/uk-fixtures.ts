/**
 * UK ground truth fixtures.
 *
 * Each entry corresponds to a real filed set of statutory accounts on
 * Companies House. ALL numeric/string fields are sourced from the filed
 * document (verified via OCR + vision transcription of the scanned PDF).
 *
 * 🔴 IMPORTANT: Every number must come from a real filed document.
 *    Do NOT fill from memory, estimation, or hallucination.
 *    Source URLs point to the company's filing history page on the
 *    Companies House find-and-update service so figures are auditable.
 *
 * Note on accounting standards: the eval harness evaluates fixtures under
 * any declared standard (FRS 102 / FRS 101 / IFRS). The tax-engine's
 * current/deferred and ETR math is standard-agnostic; the standard field
 * is recorded truthfully per each filing's basis of preparation.
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
    standard: 'IFRS',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
    noteRef: 'Note 8 (income tax expense), Note 14 (deferred tax)',
    manualAdjustments: [],
  },

  // Greggs plc — 52 weeks ended 27 December 2025
  // Source: Greggs plc Annual Report and Accounts 2025 (filed 2026-05-19)
  // Note 8 (Income tax expense) pp 150–151, Note 14 (Deferred tax) pp 159–160
  {
    companyName: 'Greggs plc',
    companiesHouseNumber: '00502851',
    accountingPeriodEnd: '2025-12-27',
    pretaxProfit: 167.4,
    totalTaxCharge: 45.2,
    currentTaxCharge: 24.8,
    deferredTaxCharge: 20.4,
    disclosedEffectiveRate: 0.27,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Items not taxable for tax purposes', amount: 2.3, type: 'permanent' },
      { label: 'Non-tax-deductible depreciation', amount: 1.1, type: 'permanent' },
      { label: 'Adjustment for prior years', amount: -0.1, type: 'other' },
    ],
    deferredTaxAssetClosing: 1.8,
    deferredTaxLiabilityClosing: 95.5,
    probableRecoveryNoted: true,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/00502851/filing-history',
    standard: 'IFRS',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // Finsbury Food Group Limited — 52 weeks ended 28 June 2025
  // Source: Finsbury Food Group Limited Annual Report and Consolidated Financial
  // Statements 2025 (filed 2026-03-27)
  // Note 8 (Taxation) p 29, Note 20 (Deferred tax assets and liabilities) pp 39–40,
  // Consolidated statement of financial position p 17
  {
    companyName: 'Finsbury Food Group Limited',
    companiesHouseNumber: '00204368',
    accountingPeriodEnd: '2025-06-28',
    pretaxProfit: 24.134,
    totalTaxCharge: 3.518,
    currentTaxCharge: 1.903,
    deferredTaxCharge: 1.615,
    disclosedEffectiveRate: 0.1458,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Non-deductible expenses and timing differences', amount: -0.7, type: 'other' },
      { label: 'Restatement of opening net deferred tax due to rate change and differences in rates', amount: 0.019, type: 'other' },
      { label: 'Group relief from holding company', amount: -2.685, type: 'other' },
      { label: 'Adjustments for prior years', amount: 0.85, type: 'other' },
    ],
    deferredTaxAssetClosing: 0,
    deferredTaxLiabilityClosing: 8.089,
    probableRecoveryNoted: true,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/00204368/filing-history',
    standard: 'FRS 101',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // Tesco plc — 53 weeks ended 28 February 2026
  // Source: Tesco PLC Annual Report and Financial Statements 2026 (filed 2026-07-25)
  // Note 7 (Taxation) p 139, Note 8 (discontinued) p 141, Group income statement p 121
  {
    companyName: 'Tesco PLC',
    companiesHouseNumber: '00445790',
    accountingPeriodEnd: '2026-02-28',
    pretaxProfit: 2403,
    totalTaxCharge: 616,
    currentTaxCharge: 506,
    deferredTaxCharge: 110,
    disclosedEffectiveRate: 0.2563,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Non-qualifying depreciation', amount: 41, type: 'permanent' },
      { label: 'Expenses not deductible', amount: 24, type: 'permanent' },
      { label: 'Net impairment (loss)/reversal of non-current assets', amount: -25, type: 'permanent' },
      { label: 'Unrecognised tax losses', amount: 5, type: 'other' },
      { label: 'Differences in overseas taxation rates', amount: -23, type: 'other' },
      { label: 'Adjustments in respect of prior years', amount: -9, type: 'other' },
      { label: 'Irrecoverable withholding tax', amount: 2, type: 'other' },
    ],
    deferredTaxAssetClosing: 49,
    deferredTaxLiabilityClosing: 635,
    probableRecoveryNoted: true,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/00445790/filing-history',
    standard: 'IFRS',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // Tesco plc — 52 weeks ended 22 February 2025
  // Source: Tesco PLC Annual Report and Financial Statements 2026 (filed 2026-07-25)
  // Note 7 (Taxation) p 139 (2025 comparatives), deferred tax balances p 141
  {
    companyName: 'Tesco PLC',
    companiesHouseNumber: '00445790',
    accountingPeriodEnd: '2025-02-22',
    pretaxProfit: 2215,
    totalTaxCharge: 611,
    currentTaxCharge: 464,
    deferredTaxCharge: 147,
    disclosedEffectiveRate: 0.2758,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Non-qualifying depreciation', amount: 41, type: 'permanent' },
      { label: 'Expenses not deductible', amount: 20, type: 'permanent' },
      { label: 'Net impairment (loss)/reversal of non-current assets', amount: 8, type: 'permanent' },
      { label: 'Unrecognised tax losses', amount: 3, type: 'other' },
      { label: 'Differences in overseas taxation rates', amount: -11, type: 'other' },
      { label: 'Adjustments in respect of prior years', amount: -12, type: 'other' },
      { label: 'Share of profits/(losses) of joint ventures and associates', amount: 1, type: 'other' },
      { label: 'Change in tax rate', amount: 4, type: 'other' },
      { label: 'Irrecoverable withholding tax', amount: 3, type: 'other' },
    ],
    deferredTaxAssetClosing: 47,
    deferredTaxLiabilityClosing: 503,
    probableRecoveryNoted: true,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/00445790/filing-history',
    standard: 'IFRS',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // Costa Limited — year ended 31 December 2024
  // Source: Costa Limited statutory accounts for the year ended 31 December 2024
  // (filed 2025-12-30)
  // Note 12 (Taxation) pp 50–53, Income statement p 25
  {
    companyName: 'Costa Limited',
    companiesHouseNumber: '01270695',
    accountingPeriodEnd: '2024-12-31',
    pretaxProfit: 65.046,
    totalTaxCharge: -1.981,
    currentTaxCharge: -9.372,
    deferredTaxCharge: 7.391,
    disclosedEffectiveRate: -0.0305,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Fixed asset differences', amount: 0.199, type: 'permanent' },
      { label: 'Income not taxable', amount: -0.538, type: 'permanent' },
      { label: 'Increase from effect of expenses not deductible in determining taxable profit', amount: 3.28, type: 'permanent' },
      { label: 'Increase/(decrease) in current tax and deferred tax from adjustment for prior periods', amount: 0.175, type: 'other' },
      { label: 'Non-taxable dividend income', amount: -21.25, type: 'permanent' },
      { label: 'Other tax movements', amount: -0.095, type: 'other' },
      { label: 'Deferred tax credited directly to OCI', amount: -0.704, type: 'other' },
      { label: 'Deferred tax charged/(credited) directly to equity', amount: 0.057, type: 'other' },
      { label: 'Deferred tax on derivatives', amount: 0.41, type: 'other' },
      { label: 'Increase from foreign tax', amount: 0.224, type: 'other' },
    ],
    deferredTaxAssetClosing: 2.068,
    deferredTaxLiabilityClosing: 15.329,
    probableRecoveryNoted: false,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/01270695/filing-history',
    standard: 'FRS 101',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // Vodafone Limited — year ended 31 March 2025
  // Source: Vodafone Limited financial statements for the year ended 31 March 2025
  // (filed 2025-12-31)
  // Note 7 (Income tax on ordinary activities) pp 39–40, Note 16 (Deferred taxation)
  // pp 48–49, Income statement p 18
  // Sign conventions in the note: charges shown in brackets, credits plain.
  // Current tax is a credit of 99.7, deferred tax a charge of 112.0, total a
  // charge of 12.3 (profit check: 111.6 − 12.3 = 99.3). The recon items are
  // credits, so they are recorded negative here.
  {
    companyName: 'Vodafone Limited',
    companiesHouseNumber: '01471587',
    accountingPeriodEnd: '2025-03-31',
    pretaxProfit: 111.6,
    totalTaxCharge: 12.3,
    currentTaxCharge: -99.7,
    deferredTaxCharge: 112.0,
    disclosedEffectiveRate: 0.1102,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Adjustments in respect of prior years', amount: -10.1, type: 'other' },
      { label: 'Permanent differences', amount: -5.5, type: 'permanent' },
    ],
    deferredTaxAssetClosing: 1602.9,
    deferredTaxLiabilityClosing: 30.6,
    probableRecoveryNoted: true,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/01471587/filing-history',
    standard: 'FRS 101',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // Farmfoods Limited — 52 weeks ended 28 December 2024
  // Source: Farmfoods Limited Annual Report and Consolidated Financial Statements
  // for the 52 week period ended 28 December 2024 (filed 2025-09-26)
  // Note 9 (Taxation) pp 24–25, Note 18 (Deferred tax assets and liabilities) p 30,
  // Consolidated P&L p 13. Genuine FRS 102 filer (basis of preparation: "Financial
  // Reporting Standard 102 The Financial Reporting Standard applicable in the UK
  // and Republic of Ireland ('FRS 102')"). Figures in £000 as presented.
  {
    companyName: 'Farmfoods Limited',
    companiesHouseNumber: 'SC030186',
    accountingPeriodEnd: '2024-12-28',
    pretaxProfit: 30465,
    totalTaxCharge: 7366,
    currentTaxCharge: -81,
    deferredTaxCharge: 7447,
    disclosedEffectiveRate: 0.2418,
    statutoryRate: 0.25,
    reconciliationItems: [
      { label: 'Net expenses adjusted for tax purposes', amount: 288, type: 'permanent' },
      { label: 'Depreciation on assets not qualifying for capital allowances', amount: 609, type: 'timing' },
      { label: 'Gain on disposal of fixed assets', amount: -1008, type: 'timing' },
      { label: 'Other timing differences', amount: 34, type: 'timing' },
      { label: '(Over)/Under provided in prior years', amount: -173, type: 'other' },
    ],
    deferredTaxAssetClosing: 4832,
    deferredTaxLiabilityClosing: 27812,
    probableRecoveryNoted: true,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/SC030186/filing-history',
    standard: 'FRS 102',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },

  // Tiny Rebel Limited — year ended 31 December 2023 (comparative year of the
  // 2024 filing)
  // Source: Tiny Rebel Limited Group Financial Statements for the year ended
  // 31 December 2024 (filed 2025) — Note 10 (Taxation) p 25, Note 23 (Deferred
  // taxation) p 30, Group P&L p 8, Group balance sheet p 10.
  // The 2023 comparative year is a genuine marginal-relief case: the ETR
  // reconciliation includes an explicit "Tax at marginal rate" line of (459),
  // and the recon balances exactly:
  //   74,872 − 51,957 − 18,761 − 1,206 + 11,274 − 190 − 459 = 18,202.
  // Period straddles the April 2023 rate change, so the recon's expected
  // charge is presented at the blended 23.52% rate (not 25%), which the
  // harness now honours via the statutoryRate field.
  // Sign convention in the note: credits bracketed, recorded negative here.
  {
    companyName: 'Tiny Rebel Limited',
    companiesHouseNumber: '07582051',
    accountingPeriodEnd: '2023-12-31',
    pretaxProfit: 318333,
    totalTaxCharge: 18202,
    currentTaxCharge: 57519,
    deferredTaxCharge: -39317,
    disclosedEffectiveRate: 0.0572,
    statutoryRate: 0.2352,
    reconciliationItems: [
      { label: 'Tax effect of expenses that are not deductible in determining taxable profit', amount: 4629, type: 'permanent' },
      { label: 'Depreciation on assets not qualifying for tax allowances', amount: 11274, type: 'permanent' },
      { label: 'Tax effect of utilisation of tax losses not previously recognised', amount: -51957, type: 'other' },
      { label: 'Adjustments in respect of prior years', amount: -18761, type: 'other' },
      { label: 'Effect of change in corporation tax rate', amount: -1206, type: 'other' },
      { label: 'Other non-reversing timing differences', amount: -190, type: 'other' },
      { label: 'Tax at marginal rate', amount: -459, type: 'other' },
    ],
    deferredTaxAssetClosing: 0,
    deferredTaxLiabilityClosing: 906668,
    probableRecoveryNoted: false,
    sourceDocumentUrl: 'https://find-and-update.company-information.service.gov.uk/company/07582051/filing-history',
    standard: 'FRS 102',
    deferredTaxBalanceSource: 'balance_sheet_fallback',
  },
];

export default fixtures;
