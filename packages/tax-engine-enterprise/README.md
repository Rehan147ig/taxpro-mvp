# @taxpro/tax-engine-enterprise

> UNVALIDATED — built from public reference material only, not reviewed by a
> CPA, tax attorney, or real ERP export. Every heuristic and assumption below
> is a guess to be corrected by a domain expert or real data, not a claim of
> correctness.

Exploratory, isolated package for multi-entity / group / GL-ingestion tax
workflows. Built from public reference material only — no CPA review, no real
ERP export, no live HMRC/IRS gateways, no RAG/vector-DB ingestion.

**Isolation contract:** no file in `apps/api`, `apps/web`, or
`packages/tax-engine` imports this package's computation engine, and it is not
wired into any route, UI, engine factory, or jurisdiction resolver. The single
cross-package consumer is the API's `rule-update-agent` subagent
(`apps/api/src/agent/subagents/rule-update-agent.ts`), which imports only the
machine-checkable proposal contract (`us/proposals.ts`) to feed the agentic
rule-refresh loop — it does not execute state tax computations for any app.

## Contents

| Module | What it is |
|--------|------------|
| `src/model/entity-groups.ts` | Drizzle schema: `entity_groups`, `entity_group_members`; type-level link to the existing single-entity provision output shape (`ProvisionSummary` from `@taxpro/tax-engine`) |
| `src/model/gl-transactions.ts` | Drizzle schema: `general_ledger_transactions` staging table |
| `src/uk/group-relief.ts` | Pure UK group relief calculator (CTA 2010 Part 5) with elimination trail and explicit non-handled gaps (consortium relief, non-coterminous periods, carried-forward losses) |
| `src/us/apportionment.ts` | US multi-state apportionment skeleton (payroll/property/sales factors, weighted fraction) |
| `src/us/valuation-allowance.ts` | ASC 740-30 valuation allowance scheduler (gross DTA → allowance allocation → net DTA; expiry/reversal scheduling warnings) |
| `src/us/quarterly.ts` | ASC 740-270 quarterly interim provision mechanics (estimated AETR method, annualized-income variant, discrete items) |
| `src/us/state-rates.ts` | 50-state + DC corporate tax reference snapshot (rate structure, apportionment formula, citation pointer) — **aligned to Tax Foundation 2026, verified by `verify:us-rates`** |
| `src/us/state-rules.ts` | State tax **rule engine**: machine-readable rulesets for all 51 jurisdictions — filing type (`cit` / `grossReceipts` / `none`), rate schedule (flat or bracketed top-tier), apportionment weights, per-row verify checklist and not-modeled gaps |
| `src/us/state-tax-engine.ts` | Executes the rulesets: apportionment fraction → state taxable income → state tax per jurisdiction; structured results for no-CIT and gross-receipts states; multistate total; rate/weight overrides |
| `src/us/external-snapshots.ts` | Dated snapshots from public sources — `SNAPSHOT_2026` + `TF_2026_RATES` (Tax Foundation 2026, published 2026-01-05, updated 2026-04-02) and `TF_2026_APPORTIONMENT` (Tax Foundation TaxEDU "State Primary Apportionment Factors for Tax Year 2026", captured 2026-08-03) |
| `src/us/verify-rates.ts` | Live-source verifier — `verifyRulesetAgainstSnapshot` / `verifyAllSnapshots` compare the engine's rulesets to the dated snapshots, reporting exact/diff/missing per jurisdiction |
| `src/us/proposals.ts` | Machine-checkable change proposal contract — `RulesetProposal` (per-jurisdiction rule diff with provenance), `validateProposal`, `diffProposalAgainstRuleset`; consumed by the API rule-update agent |
| `src/elt/heuristics.ts` | Deterministic regex flagging of GL narration → findings; every pattern marked as a guessed pattern |
| `src/elt/adapters.ts` | Interface shapes only for NetSuite / Xero / QuickBooks exports + pure normalizers; no live API code |
| `src/elt/pipeline.ts` | Chunked ELT pipeline (default 5,000 rows/chunk) with skip/report, heuristics, optional load sink |
| `ASSUMPTIONS.md` | Every assumption (regexes, heuristics, rates, rules) with what would confirm or break it |

## Scripts

- `npm run build` — tsc to `dist/` (plain build; deliberately NOT a `tsc --build`
  project-reference target, keeping the package isolated)
- `npm run lint` — `tsc --noEmit` over source and tests
- `npm run test` — vitest
- `npm run verify:us-rates` — state rule engine vs the dated Tax Foundation 2026
  snapshots (`external-snapshots.ts`); currently **51/51 rates + 51/51
  apportionment weights exact** — run after every ruleset change (the rule-refresh
  loop's verification step, see `docs/STATE_RULE_REFRESH.md`)

## Status

89 unit tests, build + lint PASS. The state tax data layer is **verified against
dated public snapshots** (rates + apportionment weights, both 51/51 exact vs Tax
Foundation 2026), and the agentic rule-refresh loop consumes the proposal
contract. Everything else remains exploratory and UNVALIDATED: before any
production use of the computation engine, review with a CPA / tax attorney,
validate regexes against a real ERP export, and replace the UNVALIDATED banner.
