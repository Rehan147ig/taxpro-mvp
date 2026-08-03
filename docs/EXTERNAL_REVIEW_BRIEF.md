# TaxPro — External Review Brief (CPA + Security Audit)

**Purpose:** Prepare `taxpro-mvp` for external professional review. This brief
tells a CPA/tax specialist and a security auditor exactly what to verify, where
the evidence lives, and what the project explicitly does NOT claim. It is the
gate before any go-live or "filing-ready" statement (roadmap hard constraints 1–2).

**Status date:** 2026-08-03. Branch `master` @ `2a4ddde`.

---

## 1. What the reviewer is being asked to certify (or not)

This is NOT a request for a rubber stamp. The honest position:

- **The tax engine is validated against audited filings** (US SEC EDGAR 15/20
  evaluated, mean ETR delta 17.5bp; UK Companies House 9/9, mean 1.3bp) — but
  "validated" means the engine reproduces disclosed ETRs from disclosed recon
  items within the stated bands. It is not a certification that the outputs are
  correct for any specific taxpayer.
- **Compliance exports (CT600 / iXBRL / MTD) are structure generators** with
  deterministic, reproducible packages and HMRC-derived rule validators. They
  are explicitly NOT filing-ready: no HMRC/Companies House schema validation or
  submission validator is integrated (readiness report §6).
- **Deterministic engine is the source of truth for official amounts**; AI
  output is advisory only and never overrides the engine (roadmap constraint 3).

The review should focus on: (a) correctness of the tax math and rate application,
(b) security of the tenant-isolation / RLS boundary and secrets handling, and
(c) whether the honesty contract (no overstated claims) holds in copy and code.

---

## 2. What the CPA / tax specialist should verify

### 2.1 Engine math

- `packages/tax-engine/src/` — US federal rate application + UK marginal
  relief. The MR formula is verified against HMRC CTM03925:
  `F × (U − A) × (N ÷ A)`; implemented as `(upper − base) × 3/200` in
  `uk-frs102-s29/rules.ts:68` (equivalent when the company is not associated
  and A = N); worked examples £125k → £29,375 and £100k → £22,750 confirmed.
- `packages/tax-engine/src/etr-reconciliation.ts` — ASC 740 ETR walk, credits
  negated, otherAdjustments as direct tax impact.
- `packages/tax-engine/src/deferred-tax.ts`, `rollforward.ts` — DTA/DTL and
  rollforward.
- UK FRS 102 S29 module (`src/uk-frs102-s29/`) — small profits rate, marginal
  relief, main rate; fixture-verified.
- Determinism: `Decimal.js` config frozen, jurisdiction factory isolation,
  `stableHash`, byte-identical package regeneration (479 tests cover these:
  118 engine + 272 API + 89 isolated enterprise).

### 2.2 Compliance export rules (Phase 6)

- `apps/api/src/modules/export/ct600-validation.ts` — 16-rule CT600 validator
  (UTR 10-digit via Box 1, CH number format, ISO period ≤ 549 days, box
  identities 15=12+13−14 / 19=15−16−17 / 22=19−20, band/rate alignment per
  regime, MR `3/200 × (£250k − A)`, straddle handling).
- `apps/api/src/modules/export/ixbrl-validation.ts` — iXBRL structural
  conformance (namespaces, schemaRef taxonomy lock `ukgaap-frs102-2023-01-01.xsd`,
  context/unit resolution, decimals="2", ISO dates, finite 2-dp numerics).
- `apps/api/src/modules/export/ct600.ts`, `ixbrl.ts`, `rd-claim.ts`, `cto-xml.ts` and `apps/api/src/modules/mtd/mtd-client.ts` —
  structure generators. **Reviewer should sanity-check box logic vs current
  HMRC guidance; fixtures reference HMRC examples.**

### 2.3 Benchmark evidence

- US: `OFFLINE=1 npm run eval -w @taxpro/api` (cached SEC filings),
  `docs/EDGAR_SKIP_GAP_REPORT.md` (skip root causes, all P1–P3 fixes landed).
- UK: `npm run eval:uk -w @taxpro/api`, fixtures with provenance in
  `apps/api/scripts/eval/uk-fixtures.ts`.
- AI mapping: `npm run eval:ai-mapping -w @taxpro/api` (real mode now unblocked).

---

## 3. What the security auditor should verify

### 3.1 Tenant isolation (RLS)

- `apps/api/src/db/migrations/rls_control_hardening.sql` + `enforce_rls_runtime_role.sql`
  — RLS enabled on all tenant tables, strict default-deny policies via
  `app_current_tenant_id()` (fail closed when no tenant context).
- `apps/api/src/config/db.ts` — `withTenantContext` sets `app.tenant_id`
  transaction-locally; `validateRuntimeRoleSecurity` refuses to start in
  non-dev when the role bypasses RLS or owns tenant tables.
- `apps/api/src/lib/middleware/rbac.ts` — partner cannot approve own run.
- Integration test asserts cross-tenant isolation across 6 resource types
  (`scripts/test-provision-flow.ts`, 27/27).

### 3.2 Secrets & config

- `.env` untracked (git-ignored); `.env.example` complete. AI keys
  (INTERFAZE/OPENAI/Companies House) read from env only, never logged.
- Prod fail-fast: weak JWT secret → startup refused; superuser DATABASE_URL →
  `assertRuntimeDbRole` refuses (verified live, readiness report table).
- `provision_events` append-only enforced at DB (trigger) + privilege level.

### 3.3 Auth & rate limiting

- JWT auth, generic failure messages (no account-existence leak).
- Rate limits: login/register 5/15min; `/api/*` 100/min; strict 20/min on
  `/api/provision/run` + `/api/provision/eve/ask`.

### 3.4 Known items the auditor should weigh

- Dev/test environments use the postgres superuser (documented limitation,
  readiness report §2) — production must use `taxpro_app` NOBYPASSRLS.
- Free OSS scanning gates run on every push/PR (all green on master):
  Semgrep `p/security-audit` (0 findings), GitHub CodeQL (security +
  extended), OSV-Scanner dependency gate (0 advisories; `npm audit` also 0
  via esbuild/uuid overrides), Trivy HIGH/CRITICAL on the API/Web images,
  Gitleaks (advisory, `continue-on-error`) + Trufflehog (`--only-verified`),
  and Dependabot (npm / Actions / Docker, grouped weekly). Auditor should
  confirm no secrets in history.
- Prod fail-fast extended to encryption keys: `TOKEN_ENCRYPTION_KEY` is
  mandatory in production (refuses to start with the dev/test fallback key),
  and GCM decryption enforces a 16-byte auth tag (`lib/crypto.ts`,
  `xero-client.ts`).
- CI runs the 479-test suite against a brand-new Postgres every push
  (bootstrap roles → migrate → seed), which caught real schema drift in
  2026-08: `provision_runs.approved_by_user_id` was in the TS schema but
  never migrated — fixed by `0012_provision_runs_approval` (idempotent).

---

## 4. Evidence index (fast-path for reviewers)

| Concern | File | Command |
|---|---|---|
| Engine math | `packages/tax-engine/src/` | `npm test` (479 tests: 118 engine + 272 API + 89 enterprise) |
| RLS/tenant isolation | `apps/api/src/config/db.ts`, migrations | `npm run test:integration -w @taxpro/api` (27/27) |
| CT600 rules | `apps/api/src/modules/export/ct600-validation.ts` | `npm test` (16 validator tests) |
| iXBRL conformance | `apps/api/src/modules/export/ixbrl-validation.ts` | `npm test` (9 validator tests) |
| US benchmark | `apps/api/scripts/eval/` | `OFFLINE=1 npm run eval -w @taxpro/api` |
| US state rules | `packages/tax-engine-enterprise/src/us/` | `npm run verify:us-rates -w @taxpro/tax-engine-enterprise` — 51/51 rates + 51/51 apportionment weights exact vs dated Tax Foundation 2026 snapshots; rule-refresh spec in `docs/STATE_RULE_REFRESH.md` |
| UK benchmark | `apps/api/scripts/eval/uk-fixtures.ts` | `npm run eval:uk -w @taxpro/api` |
| Security posture | `docs/PRODUCTION_READINESS_REPORT.md` §2–3 | — |
| CI security gates | `.github/workflows/` (ci/codeql/semgrep/deps) | green on master (SAST/CodeQL/OSV/Trivy/Dependabot) |
| Skip honesty | `docs/EDGAR_SKIP_GAP_REPORT.md` | — |
| Go-live gates | `docs/ROADMAP_PRODUCTION.md` | all Phases 1–11 ticked |

## 5. What happens after review

1. CPA sign-off on engine math + CT600 box logic (or list of required fixes).
2. Security audit report with any findings; remediate before go-live.
3. Only then may the "validated" claim extend toward "production-ready" —
   and "filing-ready" only after a real HMRC/Companies House validator is
   integrated and tested (hard constraints 1–2).
