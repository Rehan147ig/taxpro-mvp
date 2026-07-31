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
