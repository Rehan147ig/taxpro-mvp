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
export { getRateForFiscalYear } from './uk-frs102-s29/rules.js';
export { Jurisdiction } from './types.js';
export { createEngine } from './engine-factory.js';
export type { TaxEngine } from './engine-factory.js';
