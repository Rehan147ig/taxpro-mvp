// ── Tax Engine Enterprise — public entry point ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.
//
// This package is EXPLORATORY and intentionally isolated: it is not imported
// by any part of apps/api or apps/web. Do not wire it into production code
// until a CPA / tax attorney / real ERP export has validated it.

// Multi-entity data model
export * from './model/entity-groups.js';
export * from './model/gl-transactions.js';

// UK group relief (CTA 2010 Part 5, pure function)
export * from './uk/group-relief.js';

// US multi-state apportionment skeleton
export * from './us/apportionment.js';

// US valuation allowance scheduler (ASC 740-30 mechanics)
export * from './us/valuation-allowance.js';

// US quarterly interim provision (ASC 740-270 mechanics)
export * from './us/quarterly.js';

// US 50-state tax reference data (UNVALIDATED snapshot)
export * from './us/state-rates.js';

// US state tax rule engine (machine-readable rulesets for 50 states + DC)
export * from './us/state-rules.js';

// US state tax computation engine (executes the rulesets)
export * from './us/state-tax-engine.js';

// GL ingestion ELT
export * from './elt/adapters.js';
export * from './elt/heuristics.js';
export * from './elt/pipeline.js';
