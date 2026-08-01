# AI Mapping Evaluation Harness

## Overview

The AI mapping eval measures the mapping agent's classification accuracy against a curated golden dataset of 200 account names with known tax treatments.

**Golden dataset:** `packages/tax-engine/eval/golden-mapping.json`

- **Permanent differences (12):** meals, fines, life insurance, tax-exempt interest, DRD, goodwill impairment, lobbying, political contributions, parking, holiday gifts, charitable contributions, litigation settlements
- **Temporary differences (60):** depreciation (buildings, equipment, vehicles, leasehold improvements), bonus depreciation, Section 179, amortization, R&D capitalization, bad debt, warranty, deferred revenue, accrued liabilities, NOL, stock compensation, interest capitalization, deferred rent, website dev, trademarks, non-compete, customer lists, patent filing, shelf registration, hedge ineffectiveness, unrealized gains
- **No difference (128):** revenue, salaries, rent, utilities, COGS, insurance, marketing, travel, legal fees, bank charges, and ordinary business expenses

## Run Modes

`npm run eval:ai-mapping -w @taxpro/api` resolves mode automatically:

| Mode | When | Behavior |
|---|---|---|
| **dry-run** | No AI provider key configured (`isAiConfigured() === false`) | Counts golden-set distribution, skips model calls, exits 0. No accuracy claim is made. |
| **mocked** | `AI_EVAL_MODE=mocked` (or `MOCK_AI=1`) | Runs against a deterministic in-process mock model with scripted golden answers. Verifies the harness wiring end-to-end. |
| **real** | Provider key configured and `AI_EVAL_MODE=real` | Calls the configured provider (openai/nvidia/interfaze/custom). **The ≥ 80% accuracy threshold is enforced only in this mode.** |

## Threshold

- **PASS:** ≥ 80% fully correct (real mode only)
- **FAIL:** < 80% → exit code 1 (real mode only)
- **Dry-run/mocked:** informational output; exit code reflects harness health, not model accuracy

## Why the threshold is gated

Dry-run and mocked modes cannot measure the real model, so enforcing a score threshold there would be meaningless and misleading. The README, dashboard, and any market-facing material must only quote accuracy numbers produced in **real** mode.

## Deterministic safety

- Model output is validated with zod before scoring; malformed output counts as a classification failure and is reported.
- A failed model call must never corrupt the provision pipeline — the deterministic engine path is independent of AI success (verified in Phase 3 integration tests).

---

# Multi-Agent Harness (Provision Subagents)

## Overview

The agent harness evaluates the three provision subagents — **mapping-agent**, **audit-defense**, **credit-miner** — against a curated ledger fixture set in `apps/api/scripts/eval/fixtures/agent-harness/` (16 JSON fixtures: US/UK, happy-path, multi-entity, adversarial, and credit scenarios).

The harness asserts **structure only** — every output zod-validates, key fields are present/typed/finite, and fallbacks (provider errors, zod rejections, self-fallback memos) are handled gracefully and recorded. It never asserts tax math; the deterministic tax engine remains the source of truth for amounts.

## Run

```powershell
npm run harness -w @taxpro/api                          # auto mode (dry-run if no key)
$env:AI_EVAL_MODE='mocked'; npm run harness -w @taxpro/api   # scripted validation
npm run harness:real -w @taxpro/api                     # live agents (requires AI_API_KEY)
```

| Mode | When | Behavior |
|---|---|---|
| **dry-run** | No AI provider key configured | Lists fixtures, exits 0. No model calls. |
| **mocked** | `AI_EVAL_MODE=mocked` (or `MOCK_AI=1`) | Scripted responses run through the **real zod schemas**. Fixture `adversarial-unusual-transactions` emits a legacy string confidence label, proving zod rejection → fallback (recorded as `fallback rate 6.3%`, never a crash). |
| **real** | `AI_EVAL_MODE=real` (or `harness:real`) | Calls the live agents per fixture (3 invocations × 16 fixtures). Prints provider/model, never the API key. |

## Exit codes & thresholds

- **dry-run / mocked:** exit 0 (unless the harness itself crashes).
- **real:** exit 0 PASS when fallback rate ≤ `AGENT_HARNESS_FALLBACK_THRESHOLD` (default **25%**); exit 1 FAIL when exceeded.
- **real + provider outage** (403/429/timeout on every call): exit 0 with an explicit "provider unreachable — harness incomplete" message, mirroring `run-ai-mapping-eval.ts` CI behavior. The threshold still applies to agent-level failures.
- Exit 1 if the fixture set is out of range (15–20) or a fixture fails integrity validation.

## Trend log

Every run appends one JSONL line to `apps/api/scripts/eval/agent-harness-trend.jsonl` (git-ignored; `.gitkeep` tracked) and prints the last 5 runs. Override the path with `AGENT_HARNESS_TREND_FILE`. Limit fixtures with `AGENT_HARNESS_FIXTURE_LIMIT`.

## Fixture contract

Each fixture must carry: `_fixtureId` (matches filename), `tenant.id/name`, non-empty `trialBalance`, `provisionSummary` (audit-defense input), and non-empty `expectations.mapping/audit/credit`. The harness never modifies fixture files.

## Credit-miner regression note

`creditIdentificationSchema` previously declared `confidence: z.string()` while providers return numbers (`Expected string, received number` → every credit run fell back). The schema now uses `z.coerce.number()`; unit tests (`ai-subagents.test.ts`) plus fixture `credit-old-bug-numeric-confidence` guard this behavior.
