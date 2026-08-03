# @taxpro/tax-engine-enterprise

> UNVALIDATED — built from public reference material only, not reviewed by a
> CPA, tax attorney, or real ERP export. Every heuristic and assumption below
> is a guess to be corrected by a domain expert or real data, not a claim of
> correctness.

Exploratory, isolated package for multi-entity / group / GL-ingestion tax
workflows. Built from public reference material only — no CPA review, no real
ERP export, no live HMRC/IRS gateways, no RAG/vector-DB ingestion.

**Isolation contract:** no file in `apps/api`, `apps/web`, or
`packages/tax-engine` imports this package, and this package is deliberately
not wired into any route, UI, agent, engine factory, or jurisdiction resolver.

## Contents

| Module | What it is |
|--------|------------|
| `src/model/entity-groups.ts` | Drizzle schema: `entity_groups`, `entity_group_members`; type-level link to the existing single-entity provision output shape (`ProvisionSummary` from `@taxpro/tax-engine`) |
| `src/model/gl-transactions.ts` | Drizzle schema: `general_ledger_transactions` staging table |
| `src/uk/group-relief.ts` | Pure UK group relief calculator (CTA 2010 Part 5) with elimination trail and explicit non-handled gaps (consortium relief, non-coterminous periods, carried-forward losses) |
| `src/us/apportionment.ts` | US multi-state apportionment skeleton (payroll/property/sales factors, weighted fraction) — NO state rates, per-state TODO markers instead |
| `src/us/valuation-allowance.ts` | ASC 740-30 valuation allowance scheduler (gross DTA → allowance allocation → net DTA; expiry/reversal scheduling warnings) |
| `src/us/quarterly.ts` | ASC 740-270 quarterly interim provision mechanics (estimated AETR method, annualized-income variant, discrete items) |
| `src/us/state-rates.ts` | 50-state + DC corporate tax reference snapshot (rate structure, apportionment formula, citation pointer) — VERIFY against current law |
| `src/us/state-rules.ts` | State tax **rule engine**: machine-readable rulesets for all 51 jurisdictions — filing type (`cit` / `grossReceipts` / `none`), rate schedule (flat or bracketed top-tier), apportionment weights, per-row verify checklist and not-modeled gaps |
| `src/us/state-tax-engine.ts` | Executes the rulesets: apportionment fraction → state taxable income → state tax per jurisdiction; structured results for no-CIT and gross-receipts states; multistate total; rate/weight overrides |
| `src/elt/heuristics.ts` | Deterministic regex flagging of GL narration → findings; every pattern marked as a guessed pattern |
| `src/elt/adapters.ts` | Interface shapes only for NetSuite / Xero / QuickBooks exports + pure normalizers; no live API code |
| `src/elt/pipeline.ts` | Chunked ELT pipeline (default 5,000 rows/chunk) with skip/report, heuristics, optional load sink |
| `ASSUMPTIONS.md` | Every assumption (regexes, heuristics, rates, rules) with what would confirm or break it |

## Scripts

- `npm run build` — tsc to `dist/` (plain build; deliberately NOT a `tsc --build`
  project-reference target, keeping the package isolated)
- `npm run lint` — `tsc --noEmit` over source and tests
- `npm run test` — vitest

## Status

Exploratory infrastructure, not a production feature. Before any production
use: review with a CPA / tax attorney, validate regexes against a real ERP
export, and replace the UNVALIDATED banner.
