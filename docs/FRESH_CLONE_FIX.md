# Fresh Clone Fix — Bugs Found & Fixed

## BUG 1: STALE DIST — TypeError: createEngine is not a function [P0 BLOCKER]

**Root cause:** `packages/tax-engine/dist/` is gitignored (correct), but `apps/api` imports from `@taxpro/tax-engine` which resolves to `dist/`. On fresh clone, `dist/` doesn't exist, crashing at `provision-calculator.ts:4`. Additionally, `tsc` with `composite: true` uses a `.tsbuildinfo` cache file — if `dist/` is deleted but `.tsbuildinfo` remains, `tsc` skips the rebuild, leaving `dist/` missing.

**Fixes applied:**
1. `apps/api/package.json` — Added `pretest`, `predev`, `prebuild` scripts that build `@taxpro/tax-engine` first
2. `packages/tax-engine/package.json` — Changed `build` from `tsc` to `tsc --build --force` to ignore stale `.tsbuildinfo` cache
3. `apps/api/package.json` — Added missing `"test": "vitest run"` script
4. `turbo.json` pipeline already correct: `test → dependsOn build`, `build → dependsOn ^build`

## BUG 2: FIXTURE MISLABELING — IFRS labeled as FRS 102 [P0 INTEGRITY]

**Root cause:** `uk-fixtures.ts` contained `British Telecommunications plc` with comment "Group accounts (FRS 101/IFRS)" — not FRS 102. It was being evaluated as a FRS 102 fixture, falsely reporting "2 passed" for the UK benchmark.

**Fixes applied:**
1. Deleted entire `British Telecommunications plc` fixture object (lines 41-67)
2. Added `standard: "FRS 102"` field to the remaining `Greggs plc` fixture
3. Added `standard: 'FRS 102' | 'FRS 101' | 'IFRS'` field to `UkTaxFootnote` type
4. Added skip logic in `run-uk-eval.ts`: any fixture with `standard !== 'FRS 102'` is skipped with "wrong-standard" count

## BUG 3: REPORT CONTRADICTS CODEBASE

**Root cause:** `docs/PRODUCTION_READINESS_REPORT.md` claimed "Production Ready 100%" and listed several issues as unfixed that had already been addressed (rate limiter, audit log, `.env.example` entries, `parseFloat` fix).

**Fixes applied:**
1. Changed title from "Production Ready 100%" → "Status: In Development — Build Verified, Pending External Accountant Review"
2. Added "Fresh Clone Verification" section with checklist
3. Updated rate limiter section from "missing" → "wired via rateLimitMiddleware"
4. Updated audit log section from "missing" → "auditSensitiveOp helper in place"
5. Moved fixed items (`.env.example`, `parseFloat`, gzip, health, request ID, pool validation) from "Nice-to-Have" to "Addressed"
6. Updated test counts from 176 → 192
7. Removed "PRODUCTION READY" claim from recommendation section

---

## Verification Results

### Step 1-3: Clean build
```bash
rm -rf packages/tax-engine/dist
npm run build --workspace=packages/tax-engine
ls packages/tax-engine/dist/engine-factory.js
# → exists ✓
```

### Step 4: Tax-engine tests
```bash
npm test --workspace=packages/tax-engine
# → 92 passed, 0 failed ✓
```

### Step 5: API tests (fresh dist)
```bash
rm -rf packages/tax-engine/dist
npm test --workspace=apps/api
# → 83 passed, 0 failed, no TypeError ✓
# (vitest.config.ts excludes dist/ to avoid double-counting compiled .js files)
```

### Step 6: eval:uk
```bash
npm run eval:uk
# → 1 passed (Greggs only), 6 skipped (TODOs), 0 wrong-standard ✓
```

### Step 7: BT deleted
```bash
grep -r "British Telecommunications" apps/api/scripts/eval/uk-fixtures.ts
# → 0 results ✓
```

### Step 8: No "production ready" in docs
```bash
grep -ri "production ready" docs/
# → only "NOT production ready" in recommendation section ✓
```

---

## Final eval:uk output

```
TaxPro UK FRS 102 Eval Harness
Validating tax-engine ETR + deferred math against manually-curated Companies House fixtures

Fixtures loaded: 7

────────────────────────────────────────────────────────────────────────
Greggs plc (00502851) — period ended 2024-12-28
────────────────────────────────────────────────────────────────────────
  Pretax profit:       £204
  Disclosed tax:       £51  (ETR 24.80%)
  Current / deferred:  £33 / £17
  Statutory rate:      25.0%
  Recon items:         2 perm, 0 timing, 1 other
    -£2  [permanent] Items not taxable for tax purposes
    +£1  [permanent] Non-tax-deductible depreciation
    +£0  [other] Adjustment for prior years
  Engine tax:          £50  (ETR 24.75%)
  ETR delta:           5bp  →  PASS
  Deferred closing:    engine £77 vs disclosed £77  (0bp)  →  OK
  Deferred source:     balance_sheet_fallback
  Probable recovery:   noted in filing — DTA gate exercised

════════════════════════════════════════════════════════════════════════
SUMMARY
════════════════════════════════════════════════════════════════════════
  PASS  Greggs plc                     ETR    5bp  DT    0bp  
  SKIP  TODO                           ETR   n/a  DT   n/a  fixture not populated
  SKIP  TODO                           ETR   n/a  DT   n/a  fixture not populated
  SKIP  TODO                           ETR   n/a  DT   n/a  fixture not populated
  SKIP  TODO                           ETR   n/a  DT   n/a  fixture not populated
  SKIP  TODO                           ETR   n/a  DT   n/a  fixture not populated
  SKIP  TODO                           ETR   n/a  DT   n/a  fixture not populated

  1 passed, 0 warnings, 0 failed, 6 skipped
  Mean ETR delta: 5.0bp across 1 companies
  Mean deferred closing delta: 0.0bp across 1 companies
```
