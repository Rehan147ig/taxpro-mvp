// ── Tax Engine — Pure ASC 740 / FRS 102 Calculation Logic ──

export { default as Decimal } from 'decimal.js';
export * from './types.js';
export * from './constants.js';
export { calculateCurrentTax } from './current-tax.js';
export { calculateDeferredTax, calculateDeferredTaxLine } from './deferred-tax.js';
export { computeBookTaxDifferences } from './book-tax-diff.js';
export { generateRollforward } from './rollforward.js';
export { calculateETR } from './etr-reconciliation.js';
export { generateJournalEntries } from './journal-entries.js';
export { calculateUkDeferredTax, ukDeferredTaxLine } from './uk-frs102-s29/deferred-tax.js';
export { Jurisdiction } from './types.js';

export function calculateJurisdiction(config: {
  jurisdiction: 'US_ASC740' | 'UK_FRS102_S29';
  engine: 'current' | 'deferred' | 'etr';
}) {
  if (config.jurisdiction === 'UK_FRS102_S29') {
    switch (config.engine) {
      case 'deferred': return 'uk-deferred';
      default: return 'us-std';
    }
  }
  return 'us-std';
}
