# TaxPro — Production Readiness Report

**Status:** In development — build verified, benchmark harnesses green, NOT filing-ready.
**Date:** 2026-08-01
**Branch:** master
**Test Suite:** 330 tests passing (118 tax-engine + 212 API), 0 failures
**E2E Pipeline:** Playwright 4/4 (3 auth + full operator workflow with review items, AI findings, ZIP content verification, export language check); API integration flow 27/27 (in-process Hono + live Postgres, covers import → mapping → provision → AI trace polling → review → pre-lock export → submit → partner sign-off → lock → 409 → post-lock comprehensive package → audit → mapping audit → tenant isolation across 6 resources)

---

## 1. Current Verification State

| Gate | Command | Result |
|---|---|---|
| Lint / typecheck | `npm run lint` | PASS |
| Unit tests | `npm test` | 330/330 PASS (118 engine + 212 API) |
| Build | `npm run build` | PASS |
| Provision integration flow | `npm run test:integration -w @taxpro/api` | 27/27 PASS (reset → import → import export → import validation → mappings → override → provision → run-scoped mapping override → AI trace polling → review → depreciation metadata check → single resolve → bulk resolve → finalize → pre-lock export → submit → partner sign-off → lock → verification → post-lock 409 → post-lock comprehensive package → audit lifecycle → mapping+export audit events → create foreign tenant → tenant isolation across 6 resources → verify no pending agents) |
| Operator workflow E2E | `npx playwright test` (apps/web) | 4/4 PASS (auth x3 + provision → review items display → AI findings page → partner sign-off → lock → 409 → audit → ZIP content verification → export language check → dashboard status) |
| US EDGAR eval | `OFFLINE=1 npm run eval` | 2 PASS, 4 WARN, 6 SKIPPED (of 12) |
| UK eval | `npm run eval:uk` | 9/9 PASS, mean ETR delta 1.3 bp |

### 1.1 UK FRS 102 Benchmark (Companies House fixtures)

9 manually-curated real filings, ETR deltas 0–5 bp, deferred closing 0 bp:

| Company | CH Number | Period End | ETR delta |
|---|---|---|---|
| Greggs plc | 00502851 | 2024-12-28 | 5 bp |
| Greggs plc | 00502851 | 2025-12-27 | 3 bp |
| Finsbury Food Group Limited | 00204368 | 2025-06-28 | 1 bp |
| Tesco PLC | 00445790 | 2026-02-28 | 1 bp |
| Tesco PLC | 00445790 | 2025-02-22 | 1 bp |
| Costa Limited | 01270695 | 2024-12-31 | 1 bp |
| Vodafone Limited | 01471587 | 2025-03-31 | 0 bp |
| Farmfoods Limited | SC030186 | 2024-12-28 | 0 bp |
| Tiny Rebel Limited | 07582051 | 2023-12-31 | 0 bp |

The Tiny Rebel fixture exercises a genuine marginal-relief disclosure ("Tax at marginal rate" line in the ETR reconciliation) at the blended 23.52% transition rate.

### 1.2 US ASC 740 Benchmark (SEC EDGAR)

12 targeted 10-K filers. Harness semantics: PASS ≤ 25 bp, WARN ≤ 100 bp, SKIP = footnote data inadequate to test the engine (no itemized recon, or footnote does not tie internally). **SKIP is not validation.** Offline mode currently resolves 2 PASS / 4 WARN / 6 SKIPPED.

Expansion of EDGAR coverage (state tax, valuation allowance, credits, contingencies mapping) is an active workstream — see `docs/ROADMAP_PRODUCTION.md` and `docs/PUBLIC_DATA_VALIDATION.md`.

---

## 2. Security

| Check | Status | Details |
|---|---|---|
| RLS policies on all tenant tables | PASS | 13 tables with FORCE ROW LEVEL SECURITY |
| `withTenantContext` sets `app.tenant_id` per transaction | PASS | `set_config('app.tenant_id', ..., true)` |
| `requireRunAccess` rejects cross-tenant | PASS | `ForbiddenError('Cross-tenant access denied')` |
| RLS fails closed (no context = no rows) | PARTIAL | Requires `taxpro_app` role (NOBYPASSRLS) — dev uses superuser |
| `.env` not tracked | PASS | git-ignored |
| `.env.example` documents all vars | PASS | Includes AI provider, Interfaze, NetSuite, CH API key |
| Startup env validation (zod) | PASS | `env.ts` |
| Production JWT secret guard | PASS | `env.ts` rejects default secret in production |
| Secrets in source | PASS | Zero found in `src/` |

### Runtime role guard (implemented, Phase 7)

Production must connect as `taxpro_app` (NOBYPASSRLS). `assertRuntimeDbRole` (`config/db-role-guard.ts`) fails fast at startup when `NODE_ENV=production` and `DATABASE_URL` uses a superuser-like role (postgres/root), while `validateRuntimeRoleSecurity()` refuses to start in non-development if the connected role bypasses RLS or owns tenant tables. Dev still uses superuser (documented limitation).

---

## 3. Concurrency & Locking

| Check | Status |
|---|---|
| `requireRunAccess` FOR UPDATE support | PASS |
| `assertRunIsMutable` uses FOR UPDATE | PASS |
| Lock endpoint uses FOR UPDATE | PASS |
| Locked runs reject mutation with 409 | PASS |
| Cross-tenant concurrent operations | PASS (RLS + app-layer) |
| Runtime role guard (prod superuser fail-fast) | PASS | `assertRuntimeDbRole` in `config/db-role-guard.ts` + `env.ts`; unit-tested |
| NOBYPASSRLS role verification | PASS | `validateRuntimeRoleSecurity()` fails startup in non-dev; `taxpro_app` privilege assertions (append-only `provision_events`) |
| Partner cannot approve own run | PASS | `assertPartnerCanApprove` in rbac + tests |
| Auth generic failure messages | PASS | login `Invalid email or password`; register returns generic `Registration failed` (no account-existence leak) |
| Rate limiting | PASS | login/register 5/15min; global `/api/*` 100/min; strict 20/min on `/api/provision/run` + `/api/provision/eve/ask` |
| pg deprecation warning | FIXED | subagent traces now write through the shared pool (one connection per agent), not the transaction client |

---

## 4. Data Integrity & Determinism

| Check | Status |
|---|---|
| Decimal.js config frozen | PASS |
| `createEngine` jurisdiction factory isolation | PASS |
| Large-number precision ($10B × 21%) | PASS |
| `calculateCurrentTax` × 100 identical | PASS |
| `stableHash` deterministic | PASS |
| Engine current tax, deferred, ETR walk, rollforward, journal entries | PASS |
| Marginal relief (UK S29) rules + tests | PASS |

---

## 5. AI Layer

| Check | Status |
|---|---|
| Provider abstraction (openai/nvidia/interfaze/custom) | PASS — direct OpenAI-compatible client, no Vercel AI SDK |
| zod validation of structured model output | PASS — `InvalidOutputError` on malformed output |
| Retries + timeout | PASS — tested against mock server |
| Trace lifecycle started/completed/failed | PASS |
| Trace lifecycle timeout/fallback_used | PASS |
| AI mapping eval (dry-run/mocked/real modes) | PASS |
| Minimum accuracy threshold enforced in real mode only | PASS |
| Multi-agent harness (`npm run harness`): mapping/audit-defense/credit-miner | PASS — 16 fixtures, structural assertions only (deterministic engine stays source of tax math), fallback-rate threshold 25% in real mode, trend log `agent-harness-trend.jsonl` (git-ignored), provider-outage exits 0 (mirrors `run-ai-mapping-eval.ts`) |
| Credit-miner confidence schema (`z.coerce.number()`) | PASS — numeric provider confidence now validates (`Expected string, received number` regression fixed; guarded by unit test + `credit-old-bug-numeric-confidence` fixture) |

---

## 5.5 Compliance Exports (Phase 6)

| Check | Status | Details |
|---|---|---|
| CT600 box layout (CT600 2016+) + consistency flags | PASS | main rate, small profits, marginal relief (HMRC example), credits, R&D, POA, loss-year zeroing; payable/balance floored at 0 (no hidden repayment) |
| CT600 fixtures vs HMRC guidance | PASS | small-profits 19% band, HMRC marginal relief example, RDEC/surrendered-loss boxes |
| CT600 rules conformance validator | PASS | every CT600 JSON export validated (`validation` in response) against HMRC-derived rules: UTR/CH number formats, ISO period ≤ 18 months, box identities (15 = 12+13−14, 19 = 15−16−17, 22 = 19−20), band selection, rate alignment per regime (19% ≤ £50k; MR `3/200 × (£250k − A)` per CTA 2010 s.18D/CTM03925; 25% ≥ £250k; flat 19% FY2022 & earlier); straddling 1 Apr 2023 periods skipped with reason |
| iXBRL structural conformance validator | PASS | each instance/inline document carries a build-time `validation` verdict: root + namespace declarations, schemaRef taxonomy lock (`ukgaap-frs102-2023-01-01.xsd`), context/unit resolution for every fact, `decimals="2"`, ISO context dates matching document period, finite 2-dp numeric facts, Companies House identifier scheme |
| iXBRL instance + inline docs | PASS | well-formed XML, contexts/units/facts, escaping (company names, CH numbers, `& < > " '`), deterministic numeric rendering |
| iXBRL taxonomy/version metadata | PASS | schemaRef `ukgaap-frs102-2023-01-01.xsd`, `readyStatus: 'validation_ready'` honesty contract |
| MTD readiness vs submission separation | PASS | `buildMtdReadinessReport`/`assertMtdEligible` gate; sandbox `MtdClient` mock tests (token success/failure, malformed token, HTTP failure, AbortSignal timeout); live channel = CTO GovTalk XML (CT MTD API still private beta) |
| Export package contents | PASS | xlsx + audit CSV + review-items CSV + AI-traces CSV + approval-trail JSON + assumptions JSON + manifest.json (SHA-256 per file) + summary |
| Locked-run reproducibility | PASS | byte-deterministic ZIP (fixed entry dates + no volatile xlsx timestamps); byte-identical across wall-clock gaps; tests generate twice with a delay gap and assert equality |
| Package manifest integrity | PASS | schemaVersion, generatedAt, period, source/mapping/engine provenance, per-file SHA-256 verified against actual entry bytes, manifest excludes itself, fileCount matches archive |

---

## 6. Known Gaps

### Would block production go-live
- External CPA review of engine outputs (required, not yet performed).
- Formal security audit (required, not yet performed).
- Compliance exports (CT600/iXBRL/MTD) are structure generators with deterministic, reproducible packages (Phase 6) — exports are now **validated against HMRC-derived CT600 rules and iXBRL structural conformance checks (Step 2 hardening), but still not filing-ready**: no HMRC/Companies House schema (XSD) validation or submission validator is integrated.
### Must fix before major release
- US EDGAR eval coverage: 6/12 filings skipped (2 recoverable via extractor coverage, 2 untagged filer data, 2 fail the tie gate by design) — full root-cause breakdown and ranked fixes in `docs/EDGAR_SKIP_GAP_REPORT.md` (Step 4, report-only).
- Real-mode AI verified via the agent harness with a funded key (16/16 fixtures PASS, 2.1% fallback, Aug 2026). The official mapping eval still cannot run real mode end-to-end: stage-2 `max_tokens: 4096` truncation for multi-account batches and the `eval-tenant` non-UUID in `run-ai-mapping-eval.ts`. A chunked workaround measured fully-correct mapping at 79.2%/75.2% (below the 80% gate) — mapping quality remains a known gap.
### Resolved in Phase 9 hardening
- Integration test now waits for AI subagent traces to terminal states (polling with 120s timeout, 800ms interval). No false success when agent list is empty — the test fails if traces are expected but absent.
- Import and mapping APIs are now tested end-to-end in the integration flow (POST import, GET export, validation rejection, mapping override, audit events).
- Hard test-environment safety guard prevents integration test from executing against production databases.
- Post-lock package export has comprehensive manifest verification: all SHA-256 hashes checked against actual ZIP entry bytes, fileCount matches content, required files (review-items.csv, ai-traces.csv, approval-trail.json, assumptions.json) verified present.
- Tenant isolation now covers 6 resources: review items, results, package export, mappings, import data, trial balance.
- Playwright E2E strengthened: review items display verified, AI findings page checked, ZIP content verification, export page language check, dashboard status verification.

### Resolved (Phase 8)
- Frontend bundle > 500 kB warning — heavy pages (Review Queue, Run Detail, AI Findings, Audit Events, Export Package) code-split via `lazyRouteComponent`.

---

## 7. Recommendation

**Not yet production-ready.** Phases 8–9 are genuinely complete: operator UI (all 9 pages, code-split), Playwright 4/4 with strengthened assertions, API integration 25/25 covering import → mapping → provision → AI trace polling → review → lock → comprehensive package export → audit → tenant isolation across 6 resources. Remaining order: complete the Phase 10–11 checklist in `docs/ROADMAP_PRODUCTION.md` (deployment hardening + final report), then external CPA review + security audit before any go-live or "filing-ready" claim.
