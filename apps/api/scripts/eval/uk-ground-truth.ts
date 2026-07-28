/**
 * UK FRS 102 ground truth schema.
 *
 * Unlike the US EDGAR harness (which fetches live XBRL from SEC), there is
 * no equivalent instant API for UK Companies House structured data in a
 * compatible format. These fixtures are manually curated from filed accounts.
 *
 * Source: filed statutory accounts on the UK Companies House find-and-update
 * service at https://find-and-update.company-information.service.gov.uk/
 */

export interface UkReconItem {
  label: string;
  amount: number;
  type: 'permanent' | 'timing' | 'other';
}

export interface UkTaxFootnote {
  companyName: string;
  companiesHouseNumber: string;
  accountingPeriodEnd: string;
  pretaxProfit: number;
  totalTaxCharge: number;
  currentTaxCharge: number;
  deferredTaxCharge: number;
  disclosedEffectiveRate: number;
  statutoryRate: number;
  reconciliationItems: UkReconItem[];
  deferredTaxAssetClosing: number;
  deferredTaxLiabilityClosing: number;
  probableRecoveryNoted: boolean;
  sourceDocumentUrl: string;
}

const PLACEHOLDER_MARKERS = ['TODO', null, 0, ''];

export function validateFixture(f: UkTaxFootnote): string[] {
  const missing: string[] = [];

  if (!f.companyName || PLACEHOLDER_MARKERS.includes(f.companyName)) {
    missing.push('companyName');
  }
  if (!f.companiesHouseNumber || PLACEHOLDER_MARKERS.includes(f.companiesHouseNumber)) {
    missing.push('companiesHouseNumber');
  }
  if (!f.accountingPeriodEnd || PLACEHOLDER_MARKERS.includes(f.accountingPeriodEnd)) {
    missing.push('accountingPeriodEnd');
  }
  if (f.pretaxProfit === 0 || PLACEHOLDER_MARKERS.includes(f.pretaxProfit)) {
    missing.push('pretaxProfit');
  }
  if (f.totalTaxCharge === 0 && f.pretaxProfit !== 0) {
    missing.push('totalTaxCharge');
  }
  if (!f.sourceDocumentUrl || PLACEHOLDER_MARKERS.includes(f.sourceDocumentUrl)) {
    missing.push('sourceDocumentUrl');
  }

  return missing;
}
