# TaxPro — Production Roadmap

Launch checklist. Items are ordered; each must be verified by the gates in Phase 11 before go-live.

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Done

---

## Phase 1 — Repo Hygiene & Documentation

- [x] Fix README encoding (mojibake) and refresh content (React 19, TanStack Router, Turborepo, direct AI client)
- [x] `.env.example` cleaned and complete
- [x] `docs/PRODUCTION_READINESS_REPORT.md` updated with current numbers
- [x] `docs/AI_EVAL.md` documents dry-run / mocked / real modes
- [x] `docs/ROADMAP_PRODUCTION.md` (this file)
- [x] Commit changes in logical groups (docs / SDK swap / engine / exports / security / frontend / tests)

## Phase 2 — AI SDK Strategy

- [x] Replace Vercel AI SDK with direct OpenAI-compatible client (`eve/model-client.ts`, `config/ai.ts`)
- [x] Remove `ai`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `openai` dependencies
- [x] Preserve Eve operating layer and `callJsonModel` surface
- [x] zod validation on structured output; `InvalidOutputError` on malformed output
- [x] Retry/backoff on 429/5xx/network/timeout; per-attempt timeout
- [x] Tests: provider config, missing keys, timeout, malformed output, retry behavior (16 tests)

## Phase 3 — AI Outcome Quality

- [x] Subagent lifecycle states: started / completed / failed / timeout / fallback_used (trace-store + `eve/subagent-runner.ts`, default 120s timeout, `SUBAGENT_TIMEOUT_MS` override)
- [x] Integration test waits for subagent completion or timeout (not just trace creation) — `src/__tests__/ai-subagents.test.ts` (7 tests)
- [x] Tests prove: mapping agent returns validated JSON; audit defense memo persisted; credit miner output persisted; failed AI does not corrupt deterministic results; deterministic fallback works
- [x] AI eval command with dry-run / mocked / real modes (harness exists; wire modes) — `AI_EVAL_MODE=dry-run|mocked|real`, `MOCK_AI=1` alias
- [x] Enforce ≥ 80% mapping threshold only in real/provider mode

## Phase 4 — Tax Engine Accuracy

- [x] Add placed-in-service date / asset age to trial balance & account data (`placed_in_service_date` on accounts + trial_balance, engine types, `depreciation_metadata.sql`)
- [x] Replace default first-year MACRS assumption with explicit asset metadata (per-account resolution: tb date > tb age > account date > fallback)
- [x] Missing metadata → review item + low confidence (no silent first-year assumption) — `missing_depreciation_metadata` review item, run marked needs_review
- [x] Tests: current-year asset, prior-year asset, missing date, MACRS class variation, UK no-MACRS (8 new engine tests; E2E asserts the review item)
- [x] Verify US/UK engine isolation preserved (UK/non-MACRS categories never flagged; engine freeze guards intact)

## Phase 5 — Public Data Validation

- [x] Expand EDGAR mapping: state tax, foreign rate differential, credits, valuation allowance, share-based comp, contingencies, prior-year adjustments (classified buckets in `xbrl-map.ts`; math flows unchanged)
- [x] Result categories: evaluated/pass, evaluated/warn, evaluated/fail, skipped/data unavailable, skipped/footnote does not tie (`run-eval.ts` emits category + skipReason)
- [x] Never market skipped companies as validated (summary prints VALIDATED = evaluated only + explicit "NOT validated" line)
- [x] Add more UK Companies House fixtures with provenance metadata (company, year, source doc, note ref, manual adjustments — 9 fixtures; noteRef/manualAdjustments fields added)
- [x] `docs/PUBLIC_DATA_VALIDATION.md` summarizing evidence honestly
- [~] Close EDGAR skip gap (ranked fixes in `docs/EDGAR_SKIP_GAP_REPORT.md`): P1 new-taxonomy `EffectiveIncomeTaxRateReconciliation…Amount` tag collection + P1 minority-interest negative bucket **implemented 2026-08-01** (CHD/ROL/POOL → PASS, HSY 268→122 bp, NUE 663→118 bp, mean 46.5→17.4 bp); P2 percent-unit path (tie-gated) + P2 target rotation for JKHY/WDFC + re-baseline still open

## Phase 6 — Compliance Exports

- [x] CT600: validate box logic vs current HMRC guidance; fixture tests for small profits rate, marginal relief, main rate, credits, R&D
- [x] CT600: credits/POA exceeding the charge floor payable/balance at zero (never a hidden repayment); box-value consistency test
- [x] iXBRL: well-formed XML tests, taxonomy/version metadata, label output "validation-ready" not "filing-ready"; XML escaping and deterministic numeric tests
- [x] MTD: separate readiness checks from submission; mock HMRC API tests; malformed-response, HTTP-failure and AbortSignal timeout tests
- [x] Export package: calculation summary, assumptions, review items, AI traces, audit events, source hashes, approval trail
- [x] Test: locked package reproducible from immutable run data (byte-identical across wall-clock gaps — no volatile timestamps)
- [x] Package manifest: schemaVersion, generatedAt, period, source/mapping/engine provenance, per-file sha256 with self-exclusion, fileCount integrity
- [x] Step 2 hardening: CT600 rules conformance validator (HMRC-derived: CTM03925 MR formula `3/200 × (U − A)`, box identities, UTR/CH formats, ISO period rules, band/rate alignment FY2022+, straddle handling) wired into `/results/:id/ct600` JSON; iXBRL structural conformance validator (namespaces, schemaRef taxonomy lock, context/unit resolution, decimals, ISO dates, numeric format) carried on every generated document

## Phase 7 — Security & Governance

- [x] Runtime role guard: fail startup when NODE_ENV=production and DATABASE_URL uses a superuser role
- [x] Verify NOBYPASSRLS role usage in production
- [x] Tests: tenant isolation, missing tenant context, cross-tenant access, locked-run mutation rejection, partner cannot approve own run, audit append-only
- [x] `.env` untracked (verified), `.env.example` complete (done)
- [x] Rate limiting on auth + critical provision endpoints
- [x] Generic auth failure messages (no information leakage)
- [x] Fix pg deprecation warning in API tests

## Phase 8 — Frontend Product Completion

- [x] Finish TanStack Router migration; remove or archive old `App.tsx`
- [x] Pages align with backend: Dashboard, Connections, Mapping, Provision, Review Queue, Run Detail, AI Findings, Audit Events, Export Package
- [x] UI states: loading, empty, error, locked, needs review, awaiting partner approval, finalized
- [x] Route-level code splitting (fix > 500 kB bundle warning)
- [x] Operator workflows only — no marketing pages

## Phase 9 — API Integration Tests

- [x] Extend `test-provision-flow.ts`: login → import TB → mapping → provision → wait AI traces (polling with 120s timeout, terminal-state verification) → review items → resolve → submit → partner approval (different user) → lock → mutation 409 → export package (pre-lock basic + post-lock comprehensive with manifest/hash/fileCount) → audit events → tenant isolation
- [x] Hard test-environment safety guard (NODE_ENV + TAXPRO_TEST_MODE + DB host check; fails closed before any mutation)
- [x] Real AI trace polling with bounded timeout (800ms interval, 120s max; fails if agents still `started` or list unexpectedly empty)
- [x] Import workflow tested (POST import, GET export, validation rejection 400)
- [x] Mapping workflow tested (GET mappings, override before lock → 201, mapping.override audit event)
- [x] Post-lock package export with manifest integrity verification (all SHA-256 hashes checked against actual ZIP entry bytes, fileCount matches, required files present)
- [x] Cross-tenant isolation covers import, mappings, review items, results, package export
- [x] Deterministic seed producing at least one review item (depreciation account 5200, no placed-in-service date)
- [x] No pending agents at test completion
- [x] Runnable locally with Docker Postgres/Redis + TAXPRO_TEST_MODE=1

## Phase 10 — Production Deployment

- [x] Review Dockerfile / railway.json / docker-compose; fresh-clone build check (`npm ci && npm run build && npm test`)
- [x] Health checks: API, DB, Redis, worker status, AI provider (optional/graded)
- [x] Production env validation (fail fast)
- [x] Graceful worker shutdown
- [x] Logs/traces around every provision run

## Phase 11 — Final Verification & Report

Run and record: `npm run lint` · `npm test` · `npm run build` · `npm run test:integration -w @taxpro/api` · `OFFLINE=1 npm run eval` · `npm run eval:uk` · `npm run eval:ai-mapping -w @taxpro/api` (dry-run or mocked)

- [x] `npm run lint` — PASS
- [x] `npm test` — 368/368 PASS (118 engine + 250 API)
- [x] `npm run build` — PASS (3/3 workspaces)
- [x] `npm run test:integration -w @taxpro/api` — 27/27 PASS (full lifecycle + tenant isolation + package hash verification)
- [x] `OFFLINE=1 npm run eval` — 2 PASS / 4 WARN / 6 SKIP (of 12), mean ETR delta 46.5 bp
- [x] `npm run eval:uk` — 9/9 PASS, mean ETR delta 1.3 bp, deferred 0 bp
- [x] `npm run eval:ai-mapping -w @taxpro/api` (dry-run) — PASS, 202 golden entries, expected distribution printed

Final report: files changed, tests run, pass/fail, remaining risks, go-to-market readiness rating, required accountant/legal/security review.

---

## Hard Constraints (do not violate)

1. No "filing-ready" claim unless a real HMRC/Companies House validator is integrated and tested.
2. No "100% accurate" claim without external CPA review and broad public-data validation.
3. Deterministic engine remains the source of truth for official amounts.
4. Human approval is mandatory before locked/final outputs.
5. Do not remove existing user work unless verified unused and obsolete.
