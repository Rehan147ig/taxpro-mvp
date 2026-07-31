# TaxPro — Production Readiness Report

**Status:** In development — build verified, benchmark harnesses green, NOT filing-ready.
**Date:** 2026-08-01
**Branch:** master
**Test Suite:** 276 tests passing (110 tax-engine + 166 API), 0 failures
**E2E Pipeline:** 7/8 integration steps pass, 1 skipped (requires live AI provider)

---

## 1. Current Verification State

| Gate | Command | Result |
|---|---|---|
| Lint / typecheck | `npm run lint` | PASS |
| Unit tests | `npm test` | 276/276 PASS (110 engine + 166 API) |
| Build | `npm run build` | PASS |
| Provision integration flow | `npm run test:integration -w @taxpro/api` | 7/8, 1 skipped |
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

### Runtime role guard (planned)

Production must connect as `taxpro_app` (NOBYPASSRLS). A startup guard that fails fast when `NODE_ENV=production` and `DATABASE_URL` uses a superuser role is on the Phase 7 checklist.

---

## 3. Concurrency & Locking

| Check | Status |
|---|---|
| `requireRunAccess` FOR UPDATE support | PASS |
| `assertRunIsMutable` uses FOR UPDATE | PASS |
| Lock endpoint uses FOR UPDATE | PASS |
| Locked runs reject mutation with 409 | PASS |
| Cross-tenant concurrent operations | PASS (RLS + app-layer) |

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
| Trace lifecycle timeout/fallback_used | Phase 3 — in progress |
| AI mapping eval (dry-run/mocked/real modes) | Phase 3 — in progress |
| Minimum accuracy threshold enforced in real mode only | Phase 3 — in progress |

---

## 6. Known Gaps

### Would block production go-live
- External CPA review of engine outputs (required, not yet performed).
- Formal security audit (required, not yet performed).
- Compliance exports (CT600/iXBRL/MTD) are structure generators — **validation-ready, not filing-ready**. No HMRC/Companies House validator is integrated.

### Must fix before major release
- US EDGAR eval coverage: 6/12 filings skipped; mapping expansion (state tax, valuation allowance, credits, contingencies) in progress.
- MACRS assumes first-year treatment without placed-in-service date; must surface review item + low confidence instead of silent assumption.
- Runtime DB role guard (superuser detection at startup in production).
- pg deprecation warning in API tests (`client.query()` concurrency).
- Frontend bundle > 500 kB warning; code-split routes.
- Rate limiting hardening for auth + critical provision endpoints (current limiter exists for login; verify coverage).
- AI subagent integration tests must wait for completion (not just trace creation).

---

## 7. Recommendation

**Not yet production-ready.** Remaining order: complete Phase 3–10 checklist in `docs/ROADMAP_PRODUCTION.md`, then external CPA review + security audit before any go-live or "filing-ready" claim.
