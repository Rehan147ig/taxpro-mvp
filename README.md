# TaxPro — Multi-Jurisdiction Tax Provision Outcome-as-a-Service

**TypeScript | Hono.js | React 19 | TanStack Router | Turborepo | PostgreSQL RLS | BullMQ | Playwright E2E | Direct OpenAI-compatible AI client**

TaxPro turns financial trial balance data into review-ready corporate tax provisions, audit support narratives, and locked governance packages across US (ASC 740) and UK (FRS 102 Section 29) tax regimes.

TaxPro is an **Outcome-as-a-Service (OaaS)**, not an AI SaaS dashboard:

> **AI drafts and explains, deterministic math calculates, human CPAs approve and lock.**

**Official website:** [taxpro.ploy.build](https://taxpro.ploy.build/) — product overview, benchmark evidence (15/20 US, 9/9 UK, AI mapping), governance model, and pilot request. Open-source repository: this repo.

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
| **Tax engine** | ASC 740 (US) and FRS 102 Section 29 (UK) in one package: current tax, deferred tax, ETR reconciliation walk, book-tax difference computation (incl. MACRS depreciation with placed-in-service metadata), journal entries, marginal relief (UK), deterministic across runs |
| **Provision pipeline** | Eve agent analysis (`analyzeProvision`) with deterministic fallback; direct mode for deterministic-only runs; review-item generation (missing mappings, low-confidence AI mappings, missing depreciation metadata) |
| **Subagents** | Mapping agent (functional classification + tax treatment), audit-defense (ETR walk memos + risk flags), credit-miner (R&D/energy credit extraction) — all traced, all fallback-safe |
| **Compliance exports** | CT600 (box layout + fixtures vs HMRC guidance), iXBRL (instance + inline docs), CTO XML (GovTalk-style), MTD readiness, R&D claim package, Excel workbook, **ZIP package** with manifest + SHA-256 integrity |
| **Governance** | Partner approval workflow, run locking, append-only audit events, role-based access (admin/partner/reviewer/preparer/auditor/client_readonly), tenant isolation at RLS level |
| **Integrations** | NetSuite (OAuth, sandbox default), Xero, QuickBooks (QBO), Companies House import, CSV/Excel trial-balance upload |
| **Operator UI** | Dashboard, Connections, Mapping, Provision, Review Queue, Run Detail, AI Findings, Audit Events, Export Package — all code-split, Playwright-covered |
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
- **Jurisdiction isolation**: `createEngine(jurisdiction)` is a factory; each jurisdiction has its own frozen rate tables. `resolveJurisdiction()` maps persisted strings (`UK_FRS102`, `UK_FRS102_S29`, `US-Federal`, `US_ASC740`, `US`) to the engine enum with **exact matching only** — unrecognized strings log a warning and default to US instead of being silently guessed by substring matching.
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
8. **Rate limiting**: universal `/api/*` limiter (100 req/min) in **all environments**, strict 20 req/min on `/api/provision/run` + `/api/provision/eve/ask`, 5/15min on login/register.
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
│   ├── AI_EVAL.md             # eval modes + multi-agent harness contract
│   ├── PRODUCTION_READINESS_REPORT.md   # current gates, numbers, gaps
│   ├── PUBLIC_DATA_VALIDATION.md        # benchmark methodology (honesty contract)
│   └── ROADMAP_PRODUCTION.md  # launch checklist (Phases 1–11)
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
| Integrations | `/api/netsuite`, `/api/xero`, `/api/qbo` | OAuth connections, sync orchestrators |
| Demo | `/api/demo` | demo tenant data |

**RBAC roles:** `admin` > `partner` > `reviewer` > `preparer` > `auditor` > `client_readonly`. Read-only roles may only export approved/locked results; mutations require preparer+.

---

## Frontend

React 19 + TanStack Router SPA (operator workflows only, no marketing pages):

- **Pages:** Dashboard, Connections, Mapping, Provision, Review Queue, Run Detail, AI Findings (subagent trace polling), Audit Events, Export Package.
- **States handled:** loading, empty, error, locked, needs review, awaiting partner approval, finalized.
- **Performance:** route-level code splitting via `lazyRouteComponent` (fixes > 500 kB bundle warning).
- **E2E:** Playwright 4/4 — auth ×3 + full operator workflow (provision → review items display → AI findings page → partner sign-off → lock → 409 → audit → ZIP content verification → export language check → dashboard status).

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
| `TAXPRO_TEST_MODE` | no | unset | integration-test safety guard (hard-fails against production DBs) |

---

## Verification Commands

```bash
npm run lint                                   # typecheck all workspaces (tsc --noEmit)
npm test                                       # 412 unit tests (118 engine + 250 API + 44 enterprise)
npm run build                                  # full turbo build (engine → api → web)
npm run test:integration -w @taxpro/api        # 27/27 provision lifecycle (needs Docker Postgres/Redis)
npm run test:e2e                               # Playwright 4/4 operator workflow + auth (needs running stack)
npm run harness -w @taxpro/api                 # AI subagent harness (dry-run by default; AI_EVAL_MODE=mocked|real)
npm run harness:real -w @taxpro/api            # AI subagent harness against live provider
OFFLINE=1 npm run eval                         # US EDGAR harness (offline cached mode)
npm run eval:uk                                # UK FRS 102 harness — 9/9 PASS
npm run eval:ai-mapping -w @taxpro/api         # AI mapping eval (dry-run/mocked/real modes)
npm run db:migrate -w apps/api                 # run migrations
npm run db:seed -w apps/api                    # demo/partner users + demo tenant
npm run db:synthetic -w apps/api               # deterministic synthetic data (integration-test friendly)
```

### Current verification state (2026-08-03)

| Gate | Command | Result |
|---|---|---|
| Lint / typecheck | `npm run lint` | PASS |
| Unit tests | `npm test` | 412/412 PASS (118 engine + 250 API + 44 enterprise) |
| Build | `npm run build` | PASS |
| Provision integration flow | `npm run test:integration -w @taxpro/api` | 27/27 PASS (import → mapping → provision → AI trace polling → review → finalize → submit → partner sign-off → lock → 409 → package → audit → tenant isolation across 6 resources) |
| Operator workflow E2E | `npx playwright test` (apps/web) | 4/4 PASS |
| AI subagent harness | `npm run harness` (mocked) | PASS — 16/16 mapping, 16/16 audit, 15/16 credit (deliberate regression fixture), fallback 2.1% |
| US EDGAR eval | `OFFLINE=1 npm run eval` | 12 PASS, 3 WARN, 5 SKIPPED (of 20), mean ETR delta 17.5 bp — validated 15/20, 0 FAIL; also runs live in CI (non-fatal) |
| UK eval | `npm run eval:uk` | 9/9 PASS, mean ETR delta 1.3 bp |
| CI (GitHub Actions, `master`) | all 4 workflows | PASS — CI/Semgrep/CodeQL/OSV green: lint, 412 tests on a fresh Postgres (bootstrap roles → migrate → seed), Docker build + Trivy scans |

---

## CI/CD & Security Scanning

Every push/PR to `master` runs four GitHub Actions workflows (`.github/workflows/`):

| Workflow | What it runs | Status |
|---|---|---|
| `ci.yml` | 3 jobs: **Security Scan** (Gitleaks advisory + Trufflehog verified secrets), **Lint & Test** (fresh Postgres 16 + Redis 7 services: bootstrap roles → migrate → seed → 412 tests → build), **Docker Build & Scan** (API + Web images, Trivy HIGH/CRITICAL, SARIF uploaded) | green on master |
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
| Global `/api/*` | 100 req/min per IP | **all environments** (universal, not env-gated) |
| `/api/provision/run` + `/api/provision/eve/ask` | 20 req/min per IP | always |
| `/api/auth/login` + `/api/auth/register` | 5 per 15 min | always |
| `/health`, `/api/health` | exempt | — |

---

## Production Readiness Status

**Verification complete — build verified, benchmark harnesses green, integration E2E green, deployment hardening verified. NOT filing-ready.**

- UK FRS 102 engine validated against 9 curated real filings (0–5 bp ETR deltas).
- US ASC 740 engine validated against a subset of public filings; coverage expansion in progress.
- Complete operator UI (Dashboard, Review Queue, Run Detail, AI Findings, Audit Events, Export Package) covered by Playwright E2E; partner approval flow and worker split shipped.
- Compliance export package (CT600, iXBRL, MTD, CTO XML, R&D claim) includes review items, AI traces, approval trail, source hashes and a manifest — reproducible byte-identical from immutable run data. Structures are **validation-ready**, **not** HMRC/Companies House filing-ready. No claim of filing readiness is made until a real validator is integrated and tested.
- External CPA review and a formal security audit are required before general availability.
- See `docs/PRODUCTION_READINESS_REPORT.md` (current numbers) and `docs/ROADMAP_PRODUCTION.md` (launch checklist).

---

## Known Gaps

**Would block production go-live:**
- External CPA review of engine outputs (required, not yet performed).
- Formal security audit (required, not yet performed).
- Compliance exports are structure generators — no HMRC/Companies House validator integrated.

**Must fix before major release:**
- US EDGAR eval coverage: 5/20 filings skipped (CLX, HSY, BRO, TYL, NUE) — all tie-gate/filer-data gaps, root-caused in `docs/EDGAR_SKIP_GAP_REPORT.md`; 15/20 validated, 0 FAIL.
- Real-mode AI eval depends on provider availability from the dev machine; provider-outage runs degrade to fallback statistics (exit 0, explicitly reported as incomplete).

---

## License

MIT.
