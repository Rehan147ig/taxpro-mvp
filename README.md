# TaxPro — Multi-Jurisdiction Tax Provision Outcome-as-a-Service

TypeScript | Hono.js | React 19 | TanStack Router | Turborepo | PostgreSQL RLS | BullMQ | Direct OpenAI-compatible AI client

TaxPro turns financial trial balance data into review-ready corporate tax provisions, audit support narratives, and locked governance packages across US (ASC 740) and UK (FRS 102 Section 29) tax regimes.

TaxPro is an **Outcome-as-a-Service (OaaS)**, not an AI SaaS dashboard:

**AI drafts and explains, deterministic math calculates, human CPAs approve and lock.**

---

## Core Invariant

- **AI** prepares, classifies, explains, and flags risk (mapping, credit mining, audit defense, explanations).
- **Deterministic tax engine** (`@taxpro/tax-engine`, Decimal.js) computes the official amounts. The engine is the single source of truth.
- **Humans approve** official decisions — partner sign-off is required before any final/locked output.
- **Locked runs are immutable** (409 on mutation).
- **Every material action is auditable** (append-only `provision_events`).
- **Tenant data is isolated** at the PostgreSQL layer (RLS, `NOBYPASSRLS` runtime role).

---

## AI Provider Architecture

TaxPro talks to any OpenAI-compatible chat-completions endpoint **directly** — there is no Vercel AI SDK and no Vercel hosting dependency.

- `apps/api/src/eve/` — the Eve operating layer: model client, trace store, pattern store, run runtime.
- `apps/api/src/config/ai.ts` — provider resolution (`openai | nvidia | interfaze | custom`).
- Structured JSON output is validated with **zod**; malformed model output fails loudly (`InvalidOutputError`) and never silently corrupts a provision.
- Retries with backoff on transient failures (429/5xx/network/timeout); per-attempt timeout.

```text
AI_PROVIDER=openai        # or nvidia | interfaze | custom
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

---

## Empirical Benchmark Results

Both harnesses are honest about what they validate. See `docs/PUBLIC_DATA_VALIDATION.md` for the full methodology and `docs/AI_EVAL.md` for the AI mapping eval modes.

### UK FRS 102 (Companies House, manually curated fixtures)

`npm run eval:uk` — 9/9 PASS, mean ETR delta 1.3 bp, mean deferred closing delta 0.0 bp.

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

`npm run eval` — the harness evaluates filed XBRL footnote data. **Offline (cached) mode currently resolves 2 PASS, 4 WARN, 6 SKIPPED of 12 filings.** Skips are classified (`skipped/data unavailable` vs `skipped/footnote does not tie`) and are **not** counted as validated. Expanding EDGAR coverage is an active workstream (see `docs/ROADMAP_PRODUCTION.md`).

**This is a development harness, not a market claim.** US coverage must grow before any "validated across public filings" statement is made.

---

## Security & Multi-Tenant Governance

1. **Dual-role PostgreSQL setup** (`scripts/bootstrap-roles.sql`): `taxpro_migrations` (schema owner) vs `taxpro_app` (runtime, `NOBYPASSRLS`).
2. **Row-Level Security** on all tenant-owned tables: `USING (tenant_id = app_current_tenant_id())`, transaction-scoped `set_config('app.tenant_id', ...)` inside `withTenantContext`. Missing tenant context fails closed.
3. **Append-only audit trail** (`provision_events`): DB trigger rejects `UPDATE`/`DELETE`; table privileges revoked from `taxpro_app`.
4. **Segregation of duties**: partner sign-off enforces `submittedByUserId !== user.userId` and `requestedByUserId !== user.userId`.
5. **Locked runs** block modification with `409 Conflict`.
6. **AI traces** (`ai_runs`, `ai_steps`) persist started/completed/failed/timeout/fallback states with input hashes and output JSON.

---

## Monorepo Structure

```text
taxpro/
├── turbo.json                 # Turborepo task orchestration + caching
├── apps/
│   ├── api/                   # Hono.js REST API + background workers
│   │   ├── src/agent/         # Subagents: mapping, audit defense, credit miner, parser, orchestrator
│   │   ├── src/eve/           # Eve AI operating layer (model client, traces, patterns)
│   │   ├── src/modules/       # Auth, Import, Mapping, NetSuite, QBO, Xero, Provision,
│   │   │                      #   Export (iXBRL/CT600/CTO/R&D), MTD, Billing, Upload
│   │   └── scripts/           # Governance tests, provision flow tests, US/UK/AI eval harnesses
│   └── web/                   # React 19 + TanStack Router SPA
│       └── src/routes/        # Dashboard, Connections, Mapping, Provision, Review, AI Findings
└── packages/
    └── tax-engine/            # Pure ASC 740 & FRS 102 S29 engine (Decimal.js exact math)
```

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
npm run db:synthetic -w apps/api
npm run dev
```

- Frontend SPA: http://localhost:5173
- API health: http://localhost:3001/api/health

Demo credentials: `demo@taxpro.ai` / `TaxProDemo123!`

---

## Verification Commands

```bash
npm run lint                                   # typecheck all workspaces
npm test                                       # 276 unit tests (110 engine + 166 API)
npm run build                                  # full turbo build
npm run test:integration -w @taxpro/api        # provision lifecycle flow (needs Docker Postgres/Redis)
OFFLINE=1 npm run eval                         # US EDGAR harness (offline cached mode)
npm run eval:uk                                # UK FRS 102 harness — 9/9 PASS
npm run eval:ai-mapping -w @taxpro/api         # AI mapping eval (dry-run/mocked/real modes)
```

---

## Production Readiness Status

**In development — build verified, benchmark harnesses green, NOT filing-ready.**

- UK FRS 102 engine validated against 9 curated real filings (0–5 bp ETR deltas).
- US ASC 740 engine validated against a subset of public filings; coverage expansion in progress.
- Compliance export modules (CT600, iXBRL, MTD, CTO XML, R&D claim) generate **validation-ready** structures — they are **not** yet HMRC/Companies House filing-ready. No claim of filing readiness is made until a real validator is integrated and tested.
- External CPA review and a formal security audit are required before general availability.
- See `docs/PRODUCTION_READINESS_REPORT.md` (current numbers) and `docs/ROADMAP_PRODUCTION.md` (launch checklist).

---

## License

MIT.
