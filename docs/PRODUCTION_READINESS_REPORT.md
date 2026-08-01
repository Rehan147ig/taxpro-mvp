# TaxPro — Production Readiness Report

**Status:** In development — build verified, benchmark harnesses green, NOT filing-ready.
**Date:** 2026-08-01
**Branch:** master
**Test Suite:** 316 tests passing (118 tax-engine + 198 API), 0 failures
**E2E Pipeline:** 8/8 integration steps pass (in-process Hono + live Postgres; subagent calls degrade to fallback when the AI provider is unreachable)

---

## 1. Current Verification State

| Gate | Command | Result |
|---|---|---|
| Lint / typecheck | `npm run lint` | PASS |
| Unit tests | `npm test` | 316/316 PASS (118 engine + 198 API) |
| Build | `npm run build` | PASS |
| Provision integration flow | `npm run test:integration -w @taxpro/api` | 8/8 PASS |
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

---

## 5.5 Compliance Exports (Phase 6)

| Check | Status | Details |
|---|---|---|
| CT600 box layout (CT600 2016+) + consistency flags | PASS | main rate, small profits, marginal relief (HMRC example), credits, R&D, POA, loss-year zeroing |
| CT600 fixtures vs HMRC guidance | PASS | small-profits 19% band, HMRC marginal relief example, RDEC/surrendered-loss boxes |
| iXBRL instance + inline docs | PASS | well-formed XML, contexts/units/facts, escaping |
| iXBRL taxonomy/version metadata | PASS | schemaRef `ukgaap-frs102-2023-01-01.xsd`, `readyStatus: 'validation_ready'` honesty contract |
| MTD readiness vs submission separation | PASS | `buildMtdReadinessReport`/`assertMtdEligible` gate; sandbox `MtdClient` mock tests; live channel = CTO GovTalk XML (CT MTD API still private beta) |
| Export package contents | PASS | xlsx + audit CSV + review-items CSV + AI-traces CSV + approval-trail JSON + assumptions JSON + manifest.json (SHA-256 per file) + summary |
| Locked-run reproducibility | PASS | byte-deterministic ZIP (fixed entry dates), identical inputs → identical bytes |

---

## 6. Known Gaps

### Would block production go-live
- External CPA review of engine outputs (required, not yet performed).
- Formal security audit (required, not yet performed).
- Compliance exports (CT600/iXBRL/MTD) are structure generators with deterministic, reproducible packages (Phase 6) — **still validation-ready, not filing-ready**. No HMRC/Companies House validator is integrated.

### Must fix before major release
- US EDGAR eval coverage: 6/12 filings skipped; mapping expansion (state tax, valuation allowance, credits, contingencies) in progress.
- Frontend bundle > 500 kB warning; code-split routes.
- AI provider unreachable from dev machine; real-mode AI eval currently falls back to dry-run statistics (exit 0).

---

## 7. Recommendation

**Not yet production-ready.** Remaining order: complete Phase 8–10 checklist in `docs/ROADMAP_PRODUCTION.md`, then external CPA review + security audit before any go-live or "filing-ready" claim.
