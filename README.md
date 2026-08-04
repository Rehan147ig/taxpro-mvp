# TaxPro — UK FRS 102 Tax Provision Operating System

**TypeScript | Hono.js | React 19 | TanStack Router | Turborepo | PostgreSQL RLS | BullMQ | Playwright E2E | Direct OpenAI-compatible AI client**

TaxPro turns accounting data and prior tax workpapers into controlled, reviewer-approved **UK FRS 102 (Section 29) corporate tax provisions** and filing-ready evidence — for accounting firms, SME finance teams and mid-market groups.

> **Positioning:** not autonomous tax filing, not generic AI chat, not a generic tax engine, not a CT600 form filler. **AI prepares and explains; deterministic rules calculate; qualified humans approve and lock.**

**Product decision (2026-08-04):** TaxPro is a **UK-first product**. The US ASC 740 workstream is preserved in full (code, tests, evals) but **dormant by default** — feature-flagged off (`TAXPRO_ENABLE_US=false`), hidden from default navigation, onboarding and demo data, and gated at the API. UK phases A (product reset & safety), B (domain model & data foundations: entity groups, accounting/tax periods, source-document artefact store, mapping proposals with human decisions, UK rules registry, review lifecycle with waiver) and **C (UK tax-close workbench end-to-end: import → gated run → deterministic calculation → review/exceptions → recalc lineage → approval/lock gates → provenance, wired into the Workbench UI)** shipped 2026-08-04, verified against live Postgres/Redis with RLS. See `docs/UK_PRODUCT_ARCHITECTURE.md`, `docs/UK_COVERAGE_MATRIX.md` and `docs/UK_NON_GOALS.md`.

**Official website:** [taxpro.ploy.build](https://taxpro.ploy.build/) — product overview, benchmark evidence (UK 9/9 FRS 102 filings), governance model, and pilot request. Open-source repository: this repo.

---

## Table of Contents

- [Core Invariant](#core-invariant)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Features](#features)
- [AI Provider Architecture](#ai-provider-architecture)
- [Deterministic Tax Engine](#deterministic-tax-engine)
- [Subagent Pipeline](#subagent-pipeline)
- [Governance & Multi-Tenant Security](#governance--multi-tenant-security)
- [Compliance Exports](#compliance-exports)
- [Empirical Benchmark Results](#empirical-benchmark-results)
- [Monorepo Structure](#monorepo-structure)
- [API Modules](#api-modules)
- [Frontend](#frontend)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Verification Commands](#verification-commands)
- [CI/CD & Security Scanning](#cicd--security-scanning)
- [Rate Limiting](#rate-limiting)
- [Production Readiness Status](#production-readiness-status)
- [Known Gaps](#known-gaps)
- [License](#license)

---

## Core Invariant

The product rests on one non-negotiable division of labor:

1. **AI prepares, never decides.** AI classifies accounts, proposes mappings, mines tax credits, drafts audit-defense memos, and writes plain-language explanations — every output is zod-validated, traced, and reviewable.
2. **The deterministic tax engine is the single source of truth.** `@taxpro/tax-engine` (Decimal.js exact math) computes every official amount. A failed or malformed AI call can never corrupt a provision — the engine path is independent of AI success (proven by integration tests).
3. **Humans approve official decisions.** Partner sign-off is mandatory before any final or locked output; a partner cannot approve a run they submitted or requested (segregation of duties).
4. **Locked runs are immutable.** Any mutation after lock returns `409 Conflict`.
5. **Every material action is auditable.** Append-only `provision_events` (DB-trigger enforced) records run creation, calculation, review resolutions, exports, and approvals.
6. **Tenant data is isolated at the database layer.** Row-Level Security + `NOBYPASSRLS` runtime role; missing tenant context fails closed.

---

## Architecture at a Glance

```text
┌────────────────────────────────────────────────────────────────────┐
│                      Operator UI (apps/web)                        │
│   React 19 · TanStack Router · code-split pages · Playwright E2E   │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTPS / JSON
┌──────────────────────────────▼─────────────────────────────────────┐
│                    API (apps/api — Hono.js)                        │
│  auth · import · mapping · provision · agent · upload · billing    │
│  netsuite · xero · qbo · demo · health                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │ Eve AI layer │  │ Subagents    │  │ Deterministic calculator  │ │
│  │ model client │  │ mapping/audit│  │ resolveJurisdiction →     │ │
│  │ trace store  │  │ credit-miner │  │ createEngine(jurisdiction)│ │
│  │ pattern store│  │ (fallbacks)  │  │ (single source of truth)  │ │
│  └──────────────┘  └──────────────┘  └───────────────────────────┘ │
│  BullMQ workers: agent pipeline · worker-entry (separate process)  │
└───────┬──────────────────────────────────┬─────────────────────────┘
        │                                  │
┌───────▼─────────┐              ┌─────────▼─────────┐
│  PostgreSQL 16  │              │      Redis        │
│  RLS + NOBYPASS │              │   BullMQ queues   │
│  append-only    │              └───────────────────┘
│  audit events   │
└─────────────────┘
```

**The provision flow:** authenticate → import trial balance → map accounts (AI proposes, human can override) → run provision (AI agent analysis, deterministic calculation, subagents run async with traces) → resolve review items → submit for approval → partner sign-off → **lock** → export reproducible compliance package.

---

## Features

| Area | What's included |
|---|---|
| **Tax engine** | **UK FRS 102 Section 29 (default)** and ASC 740 (US, dormant behind `TAXPRO_ENABLE_US=true`) in one package: current tax, deferred tax, ETR reconciliation walk, book-tax difference computation, journal entries, marginal relief (UK), deterministic across runs |
| **Provision pipeline** | Eve agent analysis (`analyzeProvision`) with deterministic fallback; direct mode for deterministic-only runs; review-item generation (missing mappings, low-confidence AI mappings, missing depreciation metadata) |
| **Subagents** | Mapping agent (functional classification + tax treatment), audit-defense (ETR walk memos + risk flags), credit-miner (R&D/energy credit extraction) — all traced, all fallback-safe |
| **Compliance exports** | CT600 (box layout + fixtures vs HMRC guidance), iXBRL (instance + inline docs), CTO XML (GovTalk-style), MTD readiness, R&D claim package, Excel workbook, **ZIP package** with manifest + SHA-256 integrity |
| **Governance** | Partner approval workflow, run locking, append-only audit events, role-based access (admin/partner/reviewer/preparer/auditor/client_readonly), tenant isolation at RLS level |
| **Integrations** | NetSuite (OAuth, sandbox default), Xero (UK), QuickBooks (QBO — UK data source with `UK_FRS102`/GBP sync defaults), Companies House import, CSV/Excel trial-balance upload |
| **Operator UI** | Dashboard, Connections, Mapping, Provision, **Workbench (Phase C: import → gated run → recalc → provenance)**, Review Queue, Run Detail, AI Findings, Audit Events, Export Package — all code-split, Playwright-covered |
| **Observability** | OpenTelemetry (traces, metrics, logs via OTLP), structured pino logs, AI run/step traces, usage billing events |

---

## AI Provider Architecture

TaxPro talks to **any OpenAI-compatible chat-completions endpoint directly** — there is no Vercel AI SDK and no Vercel hosting dependency.

- `apps/api/src/eve/` — the **Eve operating layer**: model client, trace store, pattern store, subagent runner, run runtime.
- `apps/api/src/config/ai.ts` — provider resolution (`openai | nvidia | interfaze | custom`).
- **Structured JSON output is validated with zod**; malformed model output fails loudly (`InvalidOutputError`) and never silently corrupts a provision.
- **Retries with backoff** on transient failures (429/5xx/network/timeout) and a per-attempt timeout (`EVE_MODEL_TIMEOUT_MS`, default 60s).
- **Trace lifecycle** for every AI run: `started → completed | failed | timeout | fallback_used`, with input hashes and output JSON persisted.
- **Fallback behavior**: if the Eve agent fails, the run degrades to the deterministic calculation path, the run is marked `needs_review`, and an exception summary explains why.

```text
AI_PROVIDER=openai        # or nvidia | interfaze | custom
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

| Provider | Base URL | Example model |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `gpt-4o-mini` |
| `nvidia` | `https://integrate.api.nvidia.com/v1` | `z-ai/glm-5.2` |
| `interfaze` | `https://api.interfaze.ai/v1` (`INTERFAZE_ENDPOINT`) | `gpt-4o-mini` |
| `custom` | your own endpoint | your own model |

---

## Deterministic Tax Engine

`packages/tax-engine/` — a pure TypeScript package (Decimal.js exact math, frozen config):

- **US ASC 740**: 21% federal rate, state tax rates, permanent/temporary differences, valuation-allowance inputs, MACRS depreciation classes with per-account placed-in-service resolution (trial-balance date → asset age → account date → flagged review item instead of a silent first-year assumption), NOL utilization, tax credits, estimated payments, ETR reconciliation.
- **UK FRS 102 Section 29**: main rate / small profits rate / **marginal relief** (blended 23.52% transition rate — validated against the Tiny Rebel fixture, a genuine marginal-relief filing), no MACRS concepts, debtors/provisions presentation.
- **Jurisdiction isolation**: `createEngine(jurisdiction)` is a factory; each jurisdiction has its own frozen rate tables. `resolveJurisdiction()` maps persisted strings (`UK_FRS102`, `UK_FRS102_S29`, `US-Federal`, `US_ASC740`, `US`) to the engine enum with **exact matching only** — a missing or unrecognized jurisdiction **fails closed with an error** instead of silently guessing a regime (previously it warned and defaulted to US).
- **Determinism guarantees**: identical inputs → identical outputs, verified by repeated-run tests and the byte-identical package export test.
- **118 unit tests** covering precision ($10B × 21%), current/deferred tax, ETR walk, rollforward, journal entries, depreciation metadata, marginal relief, and engine-freeze guards.

---

## Subagent Pipeline

Three subagents run async after every provision and are traced via `ai_runs` / `ai_steps` (polled by the UI's AI Findings page):

| Subagent | Input | Output | Fallback behavior |
|---|---|---|---|
| **mapping-agent** | accounts + net balances | per-account tax account type, book treatment (`permanent`/`temporary`/`no_diff`), timing category, confidence, IRC section, explanation | zod rejection → run marked with fallback, never crashes the run |
| **audit-defense** | book income, ETR, differences | ETR walk memos with citations, risk flags (severity), quality score | self-fallback memo + explicit error text |
| **credit-miner** | trial balance, fiscal year | energy / R&D credits with amounts, confidence, notes | schema-rejection fallback (guarded by the `credit-old-bug-numeric-confidence` regression fixture) |

All subagent outputs are **structural-only**: the deterministic engine remains the source of truth for every amount. The multi-agent harness (`npm run harness`) asserts structure, fallback rates, and graceful degradation across 16 fixtures.

---

## Governance & Multi-Tenant Security

1. **Dual-role PostgreSQL setup** (`scripts/bootstrap-roles.sql`): `taxpro_migrations` (schema owner) vs `taxpro_app` (runtime, `NOBYPASSRLS`).
2. **Row-Level Security** on all 13 tenant-owned tables: `USING (tenant_id = app_current_tenant_id())`, transaction-scoped `set_config('app.tenant_id', ...)` inside `withTenantContext`. **Missing tenant context fails closed** (no rows visible).
3. **Append-only audit trail** (`provision_events`): a DB trigger rejects `UPDATE`/`DELETE`; table privileges revoked from the runtime role. Event types cover run creation, calculation, exports, review resolutions, approvals, lock.
4. **Segregation of duties**: partner sign-off enforces `submittedByUserId !== user.userId` and `requestedByUserId !== user.userId`.
5. **Locked runs** block modification with `409 Conflict` (FOR UPDATE row locks at the app layer too).
6. **AI traces** persist `started/completed/failed/timeout/fallback` states with input hashes and output JSON for every agent and subagent call.
7. **Runtime role guard**: API startup fails fast when `NODE_ENV=production` and `DATABASE_URL` resolves to a superuser-like role; `validateRuntimeRoleSecurity()` refuses to start in non-dev if the connected role bypasses RLS or owns tenant tables.
8. **Rate limiting**: universal `/api/*` limiter (100 req/min per IP in production, 1000 in development), strict 20 req/min on `/api/provision/run` + `/api/provision/eve/ask`, 5 failed login/register attempts per 15 min in production (60 in development; the dev launcher raises auth to 200). Budgets are read lazily at startup — overrides are dev-only (`AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX`), and a production-bounds test pins production to the strict defaults.
9. **Generic auth failures**: `Invalid email or password` / generic registration failure — no user enumeration.
10. **RBAC on mutations**: `POST /api/provision/run` and all review/finalize/submit/approve endpoints require `preparer | reviewer | partner | admin`; `client_readonly` and `auditor` get 403 and may only export approved or locked results.

---

## Compliance Exports

All exports are **structure generators — validation-ready, not filing-ready** (no HMRC/Companies House submission validator is integrated; no filing-ready claim is made). Since the Step 2 hardening pass, exports carry a **rules/structure conformance verdict** at build time (CT600 validated against HMRC-derived rules; iXBRL structurally conformant), which is still distinct from HMRC/Companies House filing validation.

- **CT600** (CT600 2016+): main rate, small profits rate, marginal relief (HMRC example), credits, R&D, payments-on-account, loss-year zeroing; payable/balance floored at 0 (no hidden repayment); fixture-tested against HMRC guidance. Every JSON export is validated against an HMRC-derived ruleset (`validation` in the response): UTR/Companies House number formats, ISO period rules (≤ 18 months), box identities (Box 15 = 12 + 13 − 14 etc.), band selection, and rate alignment per fiscal year — small profits 19% ≤ £50k, marginal relief `3/200 × (£250,000 − profits)` (CTA 2010 s.18D / CTM03925), main rate 25% ≥ £250k, flat 19% for FY2022 and earlier; periods straddling 1 April 2023 are flagged as not rate-verifiable.
- **iXBRL**: instance + inline docs, well-formed XML, contexts/units/facts, escaping (`& < > " '`), deterministic numeric rendering, `ukgaap-frs102-2023-01-01.xsd` taxonomy reference, `readyStatus: 'validation_ready'`. Each generated document carries a structural conformance verdict (`validation`): root/namespace declarations, schemaRef taxonomy lock, context/unit resolution for every fact, `decimals="2"`, ISO context dates, finite 2-dp numeric facts, Companies House identifier scheme.
- **CTO XML**: GovTalk-style corporation tax online submission wrapper with box-level mapping and gateway parameters.
- **MTD readiness**: readiness assessment vs submission separation (`buildMtdReadinessReport` / `assertMtdEligible`), mock HMRC client tests (token success/failure, malformed token, HTTP failure, timeout via AbortSignal).
- **R&D claim package**: RDEC scheme math, loss-making handling, headcount/PAYE inputs, spend from credit-miner or query params.
- **Locked-run ZIP package**: xlsx + audit CSV + review-items CSV + AI-traces CSV + approval-trail JSON + assumptions JSON + **manifest.json** (schemaVersion, generatedAt, period, source/mapping/engine provenance, per-file SHA-256 with self-exclusion, fileCount integrity) — **byte-deterministic** across wall-clock gaps (workbook metadata and zip DOS timestamps are both derived from the run's immutable `createdAt` in UTC — no wall-clock data; tested across a 3s gap and asserted equal).

---

## Empirical Benchmark Results

Both harnesses are honest about what they validate. Full methodology: `docs/PUBLIC_DATA_VALIDATION.md`, `docs/AI_EVAL.md`.

### UK FRS 102 (Companies House, manually curated fixtures)

`npm run eval:uk` — **9/9 PASS, mean ETR delta 1.3 bp, mean deferred closing delta 0.0 bp.**

| Company | CH Number | Period End | ETR delta | Deferred closing | Status |
|---|---|---|---|---|---|
| Greggs plc | 00502851 | 2024-12-28 | 5 bp | 0 bp | PASS |
| Greggs plc | 00502851 | 2025-12-27 | 3 bp | 0 bp | PASS |
| Finsbury Food Group Limited | 00204368 | 2025-06-28 | 1 bp | 0 bp | PASS |
| Tesco PLC | 00445790 | 2026-02-28 | 1 bp | 0 bp | PASS |
| Tesco PLC | 00445790 | 2025-02-22 | 1 bp | 0 bp | PASS |
| Costa Limited | 01270695 | 2024-12-31 | 1 bp | 0 bp | PASS |
| Vodafone Limited | 01471587 | 2025-03-31 | 0 bp | 0 bp | PASS |
| Farmfoods Limited | SC030186 | 2024-12-28 | 0 bp | 0 bp | PASS |
| Tiny Rebel Limited | 07582051 | 2023-12-31 | 0 bp | 0 bp | PASS |

The Tiny Rebel fixture is a genuine marginal-relief case: its ETR reconciliation includes an explicit "Tax at marginal rate" line, verified against the filed accounts.

### US ASC 740 (SEC EDGAR public 10-K filings)

`npm run eval` — evaluates filed XBRL footnote data. **Offline (cached) mode currently resolves 12 PASS, 3 WARN, 5 SKIPPED of 20 filings — 15/20 validated, mean ETR delta 17.5 bp.** Results are classified honestly — evaluated (`pass`/`warn`/`fail`) vs skipped (`skipped/data unavailable` vs `skipped/footnote does not tie`) — and skips are **not** counted as validated. Harness semantics: PASS ≤ 25 bp, WARN ≤ 100 bp. The 5 skips (CLX, HSY, BRO, TYL, NUE) are root-caused in `docs/EDGAR_SKIP_GAP_REPORT.md` (percentage-only/untagged filer data and tie-gate rejections — filer presentation, not engine math). The eval also runs live in CI (non-fatal).

**This is a development harness, not a market claim.** US coverage must grow before any "validated across public filings" statement is made.

### AI Mapping Eval (200-account golden set)

`npm run eval:ai-mapping -w @taxpro/api` — golden dataset at `packages/tax-engine/eval/golden-mapping.json` (12 permanent, 60 temporary, 128 no-difference accounts):

| Mode | When | Behavior |
|---|---|---|
| **dry-run** | no provider key configured | counts golden-set distribution, no model calls, exit 0 — **no accuracy claim made** |
| **mocked** | `AI_EVAL_MODE=mocked` / `MOCK_AI=1` | deterministic in-process mock with scripted golden answers; verifies harness wiring |
| **real** | key configured + `AI_EVAL_MODE=real` | calls the live provider; **≥ 80% accuracy threshold enforced only here** (exit 1 below) |

### AI Subagent Harness (16 fixtures)

`npm run harness -w @taxpro/api` — fixtures in `apps/api/scripts/eval/fixtures/agent-harness/`: happy paths (SMB, corporate RCR, tech uncertainty), multi-entity (construction, e-commerce), UK (VAT standard, B2B zero), R&D/credit (present/absent/partial + the old numeric-confidence bug), adversarial (ambiguous names, empty ledger, extreme balances, near-threshold, unusual transactions). Asserts **structure only** — zod validation, field presence/typing/finite, graceful fallbacks (provider errors, zod rejections, self-fallback memos) — never tax math.

- **dry-run / mocked:** exit 0; mocked runs scripted responses through the **real zod schemas** (the `adversarial-unusual-transactions` fixture emits a legacy string confidence label → recorded fallback, never a crash).
- **real** (`npm run harness:real`): fallback-rate threshold `AGENT_HARNESS_FALLBACK_THRESHOLD` (default 25%) — FAIL exits 1; provider outage (403/429/timeout on every call) exits 0 with "provider unreachable — harness incomplete", mirroring CI behavior; prints provider/model, never the API key.
- Every run appends a JSONL line to `agent-harness-trend.jsonl` (git-ignored, `.gitkeep` tracked) and prints the last 5 runs; `AGENT_HARNESS_TREND_FILE` overrides the path, `AGENT_HARNESS_FIXTURE_LIMIT` bounds fixtures.

---

## Monorepo Structure

```text
taxpro/
├── turbo.json                 # Turborepo task orchestration + caching
├── docker-compose.yml         # PostgreSQL 16 + Redis for local development
├── Dockerfile                 # production API image
├── docs/
│   ├── UK_PRODUCT_ARCHITECTURE.md      # UK-first product architecture + gap report
│   ├── UK_COVERAGE_MATRIX.md           # explicit UK coverage contract
│   ├── UK_NON_GOALS.md                 # non-goals: no HMRC filing, no VAT MTD, US dormant
│   ├── AI_EVAL.md             # eval modes + multi-agent harness contract
│   ├── PRODUCTION_READINESS_REPORT.md   # current gates, numbers, gaps
│   ├── PUBLIC_DATA_VALIDATION.md        # benchmark methodology (honesty contract)
│   ├── STATE_RULE_REFRESH.md  # agentic US state rule-refresh loop (source → capture → extract → verify → diff → approve → apply → CI gate)
│   └── ROADMAP_PRODUCTION.md  # launch checklist (Phases 1–11) + UK pilot phases
├── apps/
│   ├── api/                   # Hono.js REST API + background workers
│   │   ├── src/
│   │   │   ├── agent/         # subagents (mapping, audit-defense, credit-miner),
│   │   │   │                  #   parser, orchestrator (BullMQ state machine), tools
│   │   │   ├── eve/           # Eve AI operating layer (model client, traces, patterns, runtime)
│   │   │   ├── modules/       # auth, import, mapping, provision, agent, upload, billing,
│   │   │   │                  #   netsuite, xero, qbo, demo, export, mtd, health
│   │   │   ├── lib/           # middleware (auth, rbac, rate-limiter, error handler), logger
│   │   │   ├── config/        # env (zod-validated), db (RLS context), ai provider
│   │   │   ├── db/            # drizzle schema, seed, migrate
│   │   │   ├── workers.ts     # BullMQ worker split (API server vs background workers)
│   │   │   └── worker-entry.ts
│   │   └── scripts/           # bootstrap-roles.sql, migrate, seed, synthetic-seed,
│   │                          #   test-provision-flow (integration), eval/ (US/UK/AI + harness)
│   └── web/                   # React 19 + TanStack Router SPA
│       ├── src/routes/        # Dashboard, Connections, Mapping, Provision, Review Queue,
│       │                      #   Run Detail, AI Findings, Audit Events, Export Package
│       └── e2e/               # Playwright operator-workflow + auth tests
└── packages/
    ├── tax-engine/            # pure ASC 740 & FRS 102 S29 engine (Decimal.js exact math,
    │                          #   118 unit tests, eval golden datasets)
    └── tax-engine-enterprise/ # isolated exploratory US/UK/GL package (state tax rule
                               #   engine for 51 jurisdictions + live-source verifier,
                               #   89 unit tests, UNVALIDATED; only the API rule-update
                               #   agent imports its proposal contract)
```

---

## API Modules

| Module | Base path | Highlights |
|---|---|---|
| Health | `/api/health` | liveness (no auth) |
| Auth | `/api/auth` | register/login (generic failure messages), JWT 24h, rate-limited |
| Provision | `/api/provision` | entities, run (direct/eve), runs, review items, AI findings, results, exports (xlsx, ct600, rd-claim, mtd-readiness, cto-xml, package), `/eve/ask` assistant |
| Mapping | `/api/mapping` | mappings CRUD with overrides (audited), run-scoped overrides |
| Import | `/api/import` | Companies House import, trial-balance validation |
| Agent | `/api/agent` | parse, map, pipeline (BullMQ job with jurisdiction enum) |
| Upload | `/api/upload` | CSV/Excel trial balance upload |
| Billing | `/api/billing` | usage events, per-provision pricing |
| Integrations | `/api/netsuite`, `/api/xero`, `/api/qbo` | OAuth connections, sync orchestrators (QBO sync defaults to `UK_FRS102` + GBP) |
| Periods | `/api/periods` | entity groups, accounting periods, tax periods (CTA 2010 s.10 validation; non-standard → review) |
| Documents | `/api/documents` | source-document artefact store (SHA-256, provenance, versioned, immutable originals) |
| Mappings (Phase B) | `/api/mappings/proposals` | mapping proposals — AI/rules/import/carry-forward propose; humans decide; carry-forward never applies silently |
| Rules | `/api/rules` | UK rule registry — proposals, partner/admin approval, supersede/rollback, `rules_used` snapshots on runs |
| Review Items | `/api/review-items` | review lifecycle — status machine, evidence request/attach, human-only waiver, append-only history |
| Workbench (Phase C) | `/api/workbench` | UK tax-close workbench — setup (entity/period/TB/mapping state), idempotent trial-balance import, gated calculation runs, view run (deterministic snapshot + review items + warnings), recalculate-as-new-version (lineage via `parent_run_id`), blockers check; workbench runs use the standard FY2026 period and carry explicit source-document/tax-period provenance |
| Demo | `/api/demo` | demo tenant data |
| Config | `/api/config/flags` | feature flags (`enableUs` — US workstream dormant unless `TAXPRO_ENABLE_US=true`) |

**RBAC roles:** `admin` > `partner` > `reviewer` > `preparer` > `auditor` > `client_readonly`. Read-only roles may only export approved/locked results; mutations require preparer+.

**US dormancy:** `/api/provision/results/:id/us-1120` returns 403 and QBO sync rejects US-specific parameters unless `TAXPRO_ENABLE_US=true` (the QBO connector itself stays mounted — it is a UK data source).

---

## Frontend

React 19 + TanStack Router SPA (operator workflows only, no marketing pages):

- **Pages:** Dashboard, Connections, Periods, Documents, Tax Mapping, Proposals & Rules, Provision, **Workbench (UK Tax-Close Workbench — Phase C)**, Review Queue, Review Items, Run Detail, AI Findings (subagent trace polling), Audit Events, Export Package.
- **States handled:** loading, empty, error, locked, needs review, awaiting partner approval, finalized.
- **Performance:** route-level code splitting via `lazyRouteComponent` (fixes > 500 kB bundle warning).
- **E2E:** Playwright 5/5 — auth ×3 + full operator workflow (provision → review items display → AI findings page → partner sign-off → lock → 409 → audit → ZIP content verification → export language check → dashboard status) + workbench journey (import → gated run → recalc as new version → provenance → tenant isolation).

---

## Quick Start

Prerequisites: Node.js 22+, Docker Desktop (PostgreSQL 16 & Redis).

```bash
git clone https://github.com/Rehan147ig/taxpro-mvp.git
cd taxpro-mvp
cp .env.example .env          # then fill in JWT_SECRET, DATA_ENCRYPTION_KEY, AI_API_KEY
docker compose up -d
npm install
npm run db:migrate -w apps/api
npm run db:synthetic -w apps/api   # or npm run db:seed -w apps/api
npm run dev
```

- Frontend SPA: http://localhost:5173
- API health: http://localhost:3001/api/health

Demo credentials: `demo@taxpro.ai` / `TaxProDemo123!` (admin role; seed also creates `partner@taxpro.ai`).

The default seed creates a **UK FRS 102 demo tenant** (Acme UK Ltd, GBP) with Phase B domain data and Phase C workbench readiness: an entity group, FY2026 accounting/tax periods (standard 2026-01-01 period), 3 approved UK rules, a pending mapping proposal, trial-balance document metadata, 2 open review items — enough to run the Workbench import → calculate flow immediately (workbench runs are created by actually running a calculation, never by the seed). Set `TAXPRO_ENABLE_US=true` in `.env` before seeding to also create the dormant US entity.

**Production DB setup:** run `scripts/bootstrap-roles.sql` as superuser to create `taxpro_migrations` (schema owner) and `taxpro_app` (runtime, NOBYPASSRLS), then point `DATABASE_URL` at `taxpro_app` and `DATABASE_URL_MIGRATIONS` at `taxpro_migrations`. In production the API refuses to start if `DATABASE_URL` uses a superuser role.

---

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | prod | `postgres://postgres:postgres@localhost:5432/taxpro` | runtime DB (must be `taxpro_app` in prod) |
| `DATABASE_URL_MIGRATIONS` | prod | same as above | migration/schema-owner DB |
| `REDIS_URL` | yes | `redis://localhost:6379` | BullMQ queues |
| `JWT_SECRET` | yes | `change-me-in-production` | signing (rejected in prod if default) |
| `DATA_ENCRYPTION_KEY` | yes | `change-me-to-a-32-character-secret` | 32-char secret |
| `TOKEN_ENCRYPTION_KEY` | prod | dev/test fallback only | encrypts OAuth connection tokens (GCM, 16-byte auth tag); **production refuses to start without it** |
| `CORS_ORIGIN` | no | `http://localhost:5173` | allowed origin |
| `AI_PROVIDER` | no | `openai` | `openai` / `nvidia` / `interfaze` / `custom` |
| `AI_BASE_URL` | no | empty | OpenAI-compatible endpoint |
| `AI_API_KEY` | no | empty | provider key |
| `AI_MODEL` | no | empty | model id |
| `OPENAI_API_KEY` | no | empty | legacy fallback when `AI_API_KEY` empty |
| `INTERFAZE_API_KEY` | no | empty | interfaze provider key |
| `INTERFAZE_ENDPOINT` | no | `https://api.interfaze.ai/v1` | interfaze base |
| `NETSUITE_*` | no | sandbox | NetSuite OAuth (consumer key/secret, token id/secret, realm, base URL) |
| `COMPANIES_HOUSE_API_KEY` | no | empty | UK benchmark harness |
| `PORT` | no | `3001` | API port |
| `NODE_ENV` | no | `development` | env profile |
| `NODE_OPTIONS` | no | empty | e.g. `--max-old-space-size=4096` for large EDGAR runs |
| `AI_EVAL_MODE` | no | auto | `dry-run` / `mocked` / `real` |
| `MOCK_AI` | no | unset | `1` forces mocked mode |
| `AGENT_HARNESS_FALLBACK_THRESHOLD` | no | `0.25` | real-mode harness fail threshold |
| `AGENT_HARNESS_FIXTURE_LIMIT` | no | all | bound harness fixtures |
| `AGENT_HARNESS_TREND_FILE` | no | default path | trend log override |
| `EVE_MODEL_TIMEOUT_MS` | no | `60000` | per-attempt model timeout |
| `TAXPRO_ENABLE_US` | no | `false` | enable the dormant US ASC 740 workstream (US-specific QBO sync params, US 1120 export, US seed entity, US UI labels) |
| `TAXPRO_STORAGE_BACKEND` | no | `local` | source-document artefact storage backend (`local`; S3-class backends plug into the `StorageBackend` interface) |
| `TAXPRO_STORAGE_DIR` | no | `./storage` | local artefact-store directory |
| `TAXPRO_TEST_MODE` | no | unset | integration-test safety guard (hard-fails against production DBs) |

---

## Verification Commands

```bash
npm run lint                                   # typecheck all workspaces (tsc --noEmit)
npm test                                       # 537 unit tests (118 engine + 330 API + 89 enterprise)
npm run build                                  # full turbo build (engine → api → web)
npm run test:integration -w @taxpro/api        # 27/27 provision lifecycle (needs Docker Postgres/Redis)
npm run test:e2e                               # Playwright 5/5 operator workflow + auth + workbench (needs running stack)
npm run harness -w @taxpro/api                 # AI subagent harness (dry-run by default; AI_EVAL_MODE=mocked|real)
npm run harness:real -w @taxpro/api            # AI subagent harness against live provider
OFFLINE=1 npm run eval                         # US EDGAR harness (offline cached mode)
npm run eval:uk                                # UK FRS 102 harness — 9/9 PASS
npm run eval:ai-mapping -w @taxpro/api         # AI mapping eval (dry-run/mocked/real modes)
npm run verify:us-rates -w @taxpro/tax-engine-enterprise   # state rule engine vs Tax Foundation 2026 snapshots (51/51 rates + 51/51 apportionment weights)
npm run db:migrate -w apps/api                 # run migrations
npm run db:seed -w apps/api                    # demo/partner users + demo tenant
npm run db:synthetic -w apps/api               # deterministic synthetic data (integration-test friendly)
```

### Current verification state (2026-08-04 — UK Phase C shipped)

| Gate | Command | Result |
|---|---|---|
| Lint / typecheck | `npm run lint` | PASS (4/4 workspaces) |
| Unit tests | `npm test` | 537/537 PASS (118 engine + 330 API + 89 enterprise) |
| Build | `npm run build` | PASS |
| Provision integration flow | `npm run test:integration -w @taxpro/api` | 27/27 PASS (import → mapping → provision → AI trace polling → review → finalize → submit → partner sign-off → lock → 409 → package → audit → tenant isolation across 6 resources) |
| Phase C workbench API tests | `npm test -w @taxpro/api` | 330/330 PASS (31 files) — includes `phase-c-workbench` (setup/import/gated run/view/lineage) + `workbench-gates` (run + approval gates, legacy runs exempt) + `api-security` production-bounds (auth budget 5, API budget 100 in production) |
| Operator workflow E2E | `npx playwright test` (apps/web) | 5/5 PASS (auth ×3 + operator workflow + workbench import→run→recalc→provenance→tenant isolation) |
| AI subagent harness | `npm run harness` (mocked) | PASS — 16/16 mapping, 16/16 audit, 15/16 credit (deliberate regression fixture), fallback 2.1% |
| US EDGAR eval | `OFFLINE=1 npm run eval` | 12 PASS, 3 WARN, 5 SKIPPED (of 20), mean ETR delta 17.5 bp — validated 15/20, 0 FAIL; also runs live in CI (non-fatal) |
| UK eval | `npm run eval:uk` | 9/9 PASS, mean ETR delta 1.3 bp |
| US state rules vs live sources | `npm run verify:us-rates -w @taxpro/tax-engine-enterprise` | PASS — 51/51 rates + 51/51 apportionment weights exact vs Tax Foundation 2026 (see `docs/STATE_RULE_REFRESH.md`) |
| CI (GitHub Actions, `master`) | all 4 workflows | PASS — CI/Semgrep/CodeQL/OSV green: lint, 537 tests on a fresh Postgres (bootstrap roles → migrate → seed), Docker build + Trivy scans |

---

## CI/CD & Security Scanning

Every push/PR to `master` runs four GitHub Actions workflows (`.github/workflows/`):

| Workflow | What it runs | Status |
|---|---|---|
| `ci.yml` | 3 jobs: **Security Scan** (Gitleaks advisory + Trufflehog verified secrets), **Lint & Test** (fresh Postgres 16 + Redis 7 services: bootstrap roles → migrate → seed → 479 tests → build), **Docker Build & Scan** (API + Web images, Trivy HIGH/CRITICAL, SARIF uploaded) | green on master |
| `codeql.yml` | GitHub CodeQL (security + extended analysis), SARIF upload | green |
| `semgrep.yml` | Semgrep `p/security-audit` + `p/typescript` + `p/javascript` (0 blocking findings) | green |
| `deps.yml` | OSV-Scanner dependency gate (`google/osv-scanner-action/osv-scanner-action@v2.3.8`) — blocks on vulnerabilities | green |

- **Dependabot** is enabled for npm, GitHub Actions, and Docker (grouped weekly updates).
- `npm audit` is clean: overrides pin `esbuild >= 0.25.12` and `uuid >= 11.1.1` (transitive via esbuild-kit, drizzle-kit, esbuild-register, @tanstack/router-plugin).
- CI runs the suite against a **brand-new database**, which proved the fresh-clone path: it surfaced and fixed real bugs (schema drift — a column in the TS schema with no migration; and zip-entry timestamps that broke byte-reproducibility).
- Secrets hardening: GCM decryption enforces a 16-byte auth tag; `TOKEN_ENCRYPTION_KEY` is mandatory in production; the JWT default secret and a superuser `DATABASE_URL` refuse to start in prod.

---

## Rate Limiting

| Scope | Limit | Environment |
|---|---|---|
| Global `/api/*` | 100 req/min per IP (production); 1000/min (development) | dev-aware — production keeps the strict default |
| `/api/provision/run` + `/api/provision/eve/ask` | 20 req/min per IP | always |
| `/api/auth/login` + `/api/auth/register` | 5 per 15 min (production); 60 in development (dev launcher sets 200) | dev-aware — production keeps the strict default |
| `/health`, `/api/health` | exempt | — |

Budget overrides (`AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX`) are documented in `.env.example` as **development-only** — production refuses to loosen them implicitly (defaults are fixed at the strict values unless an explicit reviewed override is set). `api-security` tests pin both the production defaults and explicit overrides.

---

## Production Readiness Status

**Verification complete — build verified, benchmark harnesses green, integration E2E green, deployment hardening verified. NOT filing-ready.**

- **UK-first product reset (2026-08-04):** UK FRS 102 is the default product surface; the US ASC 740 workstream is dormant behind `TAXPRO_ENABLE_US=false` (API-gated, hidden from default UX and seed). UK architecture, coverage matrix and non-goals: `docs/UK_PRODUCT_ARCHITECTURE.md`, `docs/UK_COVERAGE_MATRIX.md`, `docs/UK_NON_GOALS.md`.
- **UK Phase C — tax-close workbench shipped (2026-08-04):** entity/period/TB setup, idempotent import, gated calculation runs, deterministic UK calc with review items (`missing_depreciation_metadata` etc.), recalc-as-new-version lineage, approval/lock gates, run detail with provenance (source/rule/assumption explainability), tenant isolation — verified end-to-end against live Postgres/Redis with RLS (API 330/330, E2E 5/5). Migrations `0014` (`workbench_runs` — run contract + `workbench_jobs` ledger with RLS) and `0015` (`connections_last_sync`) applied on the live DB. The **Phase B blocker (no live DB) is resolved**: Phase B + C are now verified on live Postgres/Redis.
- UK FRS 102 engine validated against 9 curated real filings (0–5 bp ETR deltas, mean 1.3 bp).
- US ASC 740 engine validated against a subset of public filings; dormant, preserved as future optionality.
- Complete operator UI (Dashboard, Review Queue, Run Detail, AI Findings, Audit Events, Export Package) covered by Playwright E2E; partner approval flow and worker split shipped.
- Compliance export package (CT600, iXBRL, MTD, CTO XML, R&D claim) includes review items, AI traces, approval trail, source hashes and a manifest — reproducible byte-identical from immutable run data. Structures are **validation-ready**, **not** HMRC/Companies House filing-ready. No claim of filing readiness is made until a real validator is integrated and tested.
- External CPA review and a formal security audit are required before general availability.
- See `docs/PRODUCTION_READINESS_REPORT.md` (current numbers) and `docs/ROADMAP_PRODUCTION.md` (launch checklist).

---

## Known Gaps

**Would block production go-live:**
- External tax-professional (CPA) review of engine outputs (required, not yet performed).
- Formal security audit (required, not yet performed).
- Compliance exports are structure generators — no HMRC/Companies House validator integrated.
- Real pilot validation of the UK workflow (required before any production/filing-ready claim).

**Must fix before major release:**
- US EDGAR eval coverage: 5/20 filings skipped (CLX, HSY, BRO, TYL, NUE) — all tie-gate/filer-data gaps, root-caused in `docs/EDGAR_SKIP_GAP_REPORT.md`; 15/20 validated, 0 FAIL.
- Real-mode AI eval depends on provider availability from the dev machine; provider-outage runs degrade to fallback statistics (exit 0, explicitly reported as incomplete).

---

## License

MIT.
