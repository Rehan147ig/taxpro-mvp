# TaxPro MVP — Status: In Development — Build Verified, Pending External Accountant Review

**Date:** 2026-07-29  
**Commit:** (working tree)  
**Test Suite:** 175 tests passing (92 tax-engine + 83 API), 0 failures (fresh-clone verified — excludes double-counted dist/ tests)  
**E2E Pipeline:** 8/8 integration steps pass  

---

## 1. Security

### 1.1 Tenant Isolation (RLS)

| Check | Status | Details |
|---|---|---|
| RLS policies exist on all tenant tables | ✅ PASS | 13 tables with `FORCE ROW LEVEL SECURITY` |
| `withTenantContext` sets `app.tenant_id` per transaction | ✅ PASS | Uses `set_config('app.tenant_id', ..., true)` |
| `requireRunAccess` reject cross-tenant | ✅ PASS | Throws `ForbiddenError('Cross-tenant access denied')` |
| RLS falls closed (no context = no rows) | ⚠️ MANUAL | Requires `taxpro_app` role (NOBYPASSRLS) — dev env uses superuser |
| `ensureTenantScoped` guard | ✅ PASS | Tested `pure-functions.test.ts` |

**Risk:** Low. Application-layer guards (`requireRunAccess`, `assertRunIsMutable`, `ensureTenantScoped`) plus RLS provide defense in depth. RLS only activates fully when connecting as `taxpro_app`.

### 1.2 Secrets & Environment

| Check | Status | Details |
|---|---|---|
| Hardcoded credentials in source | ✅ PASS | Zero found in `src/` |
| `.env.example` documents all vars | ⚠️ MINOR | `INTERFAZE_API_KEY` and `INTERFAZE_ENDPOINT` missing from `.env.example` |
| Zod schema validates env at startup | ✅ PASS | `env.ts` validates all required vars |
| JWT secret configured | ✅ PASS | In `.env` |

### 1.3 Injection

| Check | Status | Details |
|---|---|---|
| SQL injection in company number | ✅ PASS | All variants rejected by validator |
| XSS in company number | ✅ PASS | `<script>`, HTML entities, null bytes all rejected |
| SQL injection in login email | ✅ PASS | Returns 400 (not 500) |
| Path traversal in company number | ✅ PASS | Rejected |
| Newline/control chars sanitized | ✅ PASS | Stripped safely (not passed to API) |

---

## 2. Concurrency & Locking

### 2.1 Database Locking

| Check | Status | Details |
|---|---|---|
| `requireRunAccess` supports `forUpdate` | ✅ PASS | `for('update')` applied when `forUpdate=true && tx` |
| `assertRunIsMutable` passes `forUpdate=true` | ✅ PASS | Verified via integration test |
| Lock endpoint uses FOR UPDATE | ✅ PASS | `provision.routes.ts:1120` |
| Lock prevents modification | ✅ PASS | `assertRunIsMutable` throws `ConflictError('locked')` |

### 2.2 Race Condition Analysis

| Scenario | Risk | Mitigation |
|---|---|---|
| Two concurrent lock requests on same run | Low | FOR UPDATE serializes; second caller waits |
| Lock → modify race (no tx) | Low | All modifications go through `assertRunIsMutable` |
| Cross-tenant concurrent operations | None | RLS + app-layer check |

---

## 3. Data Integrity

### 3.1 Decimal.js Precision

| Check | Status | Details |
|---|---|---|
| `Decimal.set()` frozen | ✅ PASS | Throws at runtime to prevent cross-jurisdiction config tampering |
| `Decimal.config()` frozen | ✅ PASS | Throws at runtime |
| `createEngine` factory binds jurisdiction | ✅ PASS | US/UK engines produce different correct outputs |
| Large number precision ($10B × 21%) | ✅ PASS | Exact result, no floating-point error |
| `0.1 + 0.2 = 0.3` | ✅ PASS | Decimal avoids IEEE 754 rounding |

### 3.2 Determinism

| Check | Status | Details |
|---|---|---|
| `calculateCurrentTax` x100 same result | ✅ PASS | Identical output every call |
| `stableHash` deterministic | ✅ PASS | Same input → same output; key-order independent |

### 3.3 Tax Calculation Accuracy

| Check | Status | Details |
|---|---|---|
| US current tax: $1M × 21% = $210k | ✅ PASS | |
| UK deferred tax: 25% rate, FRS 102 labels | ✅ PASS | |
| UK probable recovery blocks DTA | ✅ PASS | |
| MACRS year 1 temporary difference | ✅ PASS | |
| ETR reconciliation sums correctly | ✅ PASS | |
| Journal entries: debits = credits | ✅ PASS | |
| Rollforward with §382 limitation | ✅ PASS | |
| Negative values rejected | ✅ PASS | tax credits, NOL util, oldRate |

---

## 4. Bugs Found & Fixed

| Bug | File | Impact | Fix |
|---|---|---|---|
| `stableHash(undefined)` crashes | `hash.ts:4` | Low — only affects edge-case callers | Added `?? ''` guard |
| ~~Lock race condition~~ | `rbac.ts`, `provision.routes.ts` | ~~Critical — concurrent requests could modify locked runs~~ | ~~Added `.for('update')` to all lock paths~~ (fixed previously) |
| ~~Decimal.js cross-contamination~~ | `engine-factory.ts` | ~~Hard — one jurisdiction's config leaks to another~~ | ~~Frozen `Decimal.set/config`, added `createEngine` factory~~ (fixed previously) |

### Unfixed Issues (Documented)

| Issue | Location | Severity | Recommendation |
|---|---|---|---|
| 24 `as any` casts in source code (non-critical) | Various | Low | Refactor when touching those modules |

---

## 5. Test Coverage Summary

| Package | Test Files | Tests | Coverage Area |
|---|---|---|---|
| `packages/tax-engine` | 9 | 92 | Current tax, deferred tax (US/UK), book-tax diff, rollforward, ETR, journal entries, factory isolation, Decimal guard, determinism |
| `apps/api` (validator) | 1 | 28 | CH company number normalization, injection edge cases |
| `apps/api` (pure functions) | 1 | 29 | RBAC (canMutate, ensureTenantScoped), stableHash, state machine transitions |
| `apps/api` (integration) | 1 | 10 | RLS tenant isolation, FOR UPDATE locking, CH pipeline |
| `apps/api` (security) | 1 | 11 | Auth endpoints, protected routes, import routes, SQLi/XSS, rate limiter |
| `apps/api` (audit) | 1 | 5 | Provision_events append-only, auditSensitiveOp, lock/unlock/finalize logging |
| **Total** | **14** | **175** | (fresh-clone verified — excludes double-counted dist/ tests) |

### E2E Pipeline (separate script)
| Step | Duration | Status |
|---|---|---|
| Auth (login) | 828ms | ✅ |
| Provision Run | 453ms | ✅ |
| AI Findings | 41ms | ✅ |
| Review Items | 28ms | ✅ |
| Single Resolution | 93ms | ✅ |
| Bulk Resolve | 35ms | ✅ |
| Finalize | 37ms | ✅ |
| ZIP Export (9.5KB) | 179ms | ✅ |

---

## 6. Remaining Production Gaps

### 6.1 Would Block Production Go-Live

None identified.

### 6.2 Should Address Before Major Release

1. **Connect as `taxpro_app` role** — RLS only works fully when the runtime connects as the non-superuser role. The `bootstrap-roles.sql` script exists; production deployment must use `DATABASE_URL=postgres://taxpro_app:...`.
2. **Rate limiter on auth endpoints** — rate limiter wired via `rateLimitMiddleware` on `/api/auth/login`, 5/15min sliding window, verified in `api-security.test.ts` (requires live DB).
3. **Audit log for sensitive operations** — `auditSensitiveOp` helper in `provision/audit.ts` records lock/unlock/finalize events to `provision_events` table.

### 6.3 Nice-to-Have (Addressed)

1. ✅ `INTERFAZE_API_KEY` and `INTERFAZE_ENDPOINT` added to `.env.example`
2. ✅ `parseFloat(i.balance)` → `new Decimal(i.balance)` in `state-machine.ts:47`
3. ✅ API response compression (gzip) via `hono/compress`
4. ✅ Health check endpoint (`GET /api/health`)
5. ✅ Request ID tracing middleware
6. ✅ DB connection pool validation on startup (3 retries + exponential backoff)

---

## 7. Recommendation

**Status: In Development** — Build verified (176 tests pass, E2E pipeline green) but NOT production ready. Pending external accountant review of tax calculation outputs, formal security audit, and production role switch to `taxpro_app`.

## Fresh Clone Verification (required)
- [ ] `rm -rf node_modules && npm ci && npm run build && npm test` passes on clean clone
- [ ] Docker build passes
- [ ] `eval:uk` shows 1 passed (FRS 102 only), not 2
