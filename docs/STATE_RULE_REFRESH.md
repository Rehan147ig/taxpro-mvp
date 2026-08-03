# The Agentic Rule-Refresh Loop — keeping the US state tax engine honest

Status: implemented end-to-end (2026-08-03). Scope: US state corporate income
tax rules (rates, schedule structure, filing type, apportionment weights).
The same loop generalizes to any fast-changing tax rule (US federal changes,
state R&D credits, apportionment sourcing rules, etc.).

## Why this exists

The UK is a closed system: one rate, one form, changes rarely. Static code
works. The US is an open system: 51 jurisdictions, each with its own rate,
schedule, and apportionment formula, changing every legislative session.

The proof is in the data. Our first snapshot (assembled ~2026-07-26) was stale
against the Tax Foundation's 2026 table in **25 of 51 rows** — and the
apportionment weights, verified two days later against Tax Foundation TaxEDU,
were wrong in **8 of 51 rows** (DE/MT not three-factor, KS/ND/NM/OK not
single-sales, FL/VA not single-sales). No manual maintenance can win that
game. The loop below turns "freshness" into a CI-enforced property and an
AI-assisted workflow with a CPA in the loop.

## The loop

```
             ┌──────────────────────────────────────────────────────────┐
             │ 1. SOURCE                                                │
             │ dated legal text: statute, revenue bulletin, published   │
             │ rate/apportionment table (TF 2026, FTA, state revenue)   │
             └──────────────────────────────┬───────────────────────────┘
                                            ▼
             ┌──────────────────────────────────────────────────────────┐
             │ 2. CAPTURE — external-snapshots.ts                       │
             │ machine-readable rows + provenance: name, URL, published,│
             │ captured, tax year. Snapshot changes are the ONLY way a  │
             │ rule update may start.                                   │
             └──────────────────────────────┬───────────────────────────┘
                                            ▼
             ┌──────────────────────────────────────────────────────────┐
             │ 3. EXTRACT — rule-update-agent (apps/api)                │
             │ LLM reads the source text and emits a RulesetProposal in │
             │ the EXACT shape the engine executes; provenance forced   │
             │ from input (agent never invents URLs).                   │
             └──────────────────────────────┬───────────────────────────┘
                                            ▼
             ┌──────────────────────────────────────────────────────────┐
             │ 4. VERIFY — validateProposal (deterministic)             │
             │ sane rate range 0..0.2, known state code, weights sum to │
             │ 1, provenance + excerpt + reasoning present. Invalid      │
             │ proposals fail loudly — never silently coerced.          │
             └──────────────────────────────┬───────────────────────────┘
                                            ▼
             ┌──────────────────────────────────────────────────────────┐
             │ 5. DIFF — diffProposalAgainstRuleset                     │
             │ "what would change": rate, schedule, filing type,        │
             │ weights — the review summary a CPA approves. No-op       │
             │ proposals are breaking: false.                           │
             └──────────────────────────────┬───────────────────────────┘
                                            ▼
             ┌──────────────────────────────────────────────────────────┐
             │ 6. APPROVE — human CPA (review-queue pattern)            │
             │ the reviewer sees diff + excerpt + source citation.      │
             └──────────────────────────────┬───────────────────────────┘
                                            ▼
             ┌──────────────────────────────────────────────────────────┐
             │ 7. APPLY — ruleset AND snapshot updated together         │
             │ state-rates.ts / state-rules.ts change with the snapshot │
             │ row and its fetchedAt. Never one without the other.      │
             └──────────────────────────────┬───────────────────────────┘
                                            ▼
             ┌──────────────────────────────────────────────────────────┐
             │ 8. GATE — verifier + engine tests (CI)                   │
             │ npm run verify:us-rates fails on ANY drift vs the dated  │
             │ snapshots; engine tests lock the computation. Stale tax  │
             │ data is a failing build, not a silent miscomputation.    │
             └──────────────────────────────────────────────────────────┘
```

## Mapping to the codebase

| Step | Where | What |
|---|---|---|
| Capture | `packages/tax-engine-enterprise/src/us/external-snapshots.ts` | `SNAPSHOT_2026` — 51 rows × (topRate, scheduleKind, filingType, weights) + `TF_2026_RATES` and `TF_2026_APPORTIONMENT` provenance |
| Extract | `apps/api/src/agent/subagents/rule-update-agent.ts` | `runRuleUpdateAgent()` — zod schema → `callJsonModel` → typed proposal |
| Verify | `packages/tax-engine-enterprise/src/us/proposals.ts` | `validateProposal()` — deterministic, unit-tested without an LLM |
| Diff | same file | `diffProposalAgainstRuleset()` — human-readable change list |
| Gate | `scripts/verify-state-rates.test.ts` (`npm run verify:us-rates`) + full `npm test` | every snapshot row must match `STATE_RULESET` exactly; engine tests (state-rules, state-tax-engine, proposals) lock behavior |

## Rules that make it safe

1. **One-way door on the snapshot.** The verifier compares ruleset → snapshot.
   Editing the snapshot to match the ruleset is the forbidden direction (it
   would pass CI on stale data) — tracked as the "Would break" in assumption
   3A.9/3A.10.
2. **Provenance is forced, never invented.** The agent's `source` fields come
   from the caller's input; the LLM only supplies the extracted rule, excerpt,
   confidence, and reasoning.
3. **Deterministic contract.** Everything after the LLM call is pure data —
   the agent is replaceable, but the contract (`RulesetProposal`) is enforced
   by zod + `validateProposal` + tests.
4. **Human approval is mandatory.** The loop ships the *extraction* half. The
   apply step (7) is deliberately not automated: a CPA reviews the diff, then
   the ruleset + snapshot change atomically in one commit.
5. **Failing loudly.** Invalid model output, malformed JSON, or an
   out-of-range rate surfaces as an error with the issues — never a silent
   coercion (same contract as the CT600/US-1120 export validators).

## Live verification status (2026-08-03)

- Rates: Tax Foundation "State Corporate Income Tax Rates and Brackets, 2026"
  (published 2026-01-05, updated 2026-04-02) — **51/51 rows exact**.
- Apportionment: Tax Foundation TaxEDU "State Primary Apportionment Factors
  for Tax Year 2026" (captured 2026-08-03) — **51/51 rows exact**.
- Known flags carried on the ruleset (not silent): KS apportionment (SSF
  enacted 2024 — effective date to confirm), OK single-sales election,
  FL/VA double-weighted sales, bracketed states apply top tier to the full
  base, CT 10% surtax and NJ entire-net-income application are `notModeled`.
- Verifier output: `jurisdictions checked: 51, exact matches: 51,
  mismatches: 0`.

## Extending the loop

To add a rule dimension (e.g. market-based sourcing rules, NOL carryforward
limits, credit rates): extend `SnapshotRow` + the verifier with one more
field, mirror the field in `RulesetProposal`, and add engine fixtures. The
CI gate then covers it automatically.
