# TaxPro Enterprise — Comprehensive Knowledge Transfer (KT) for AI & Systems Engineers

---

## 1. Executive Summary & Product Architecture

TaxPro Enterprise is an **AI-Native Outcome-as-a-Service (OaaS) Multi-Jurisdiction Corporate Tax Provision Platform** supporting both US (ASC 740) and UK (FRS 102 Section 29) tax regimes. 

### Fundamental Operating Model
Instead of selling complex SaaS spreadsheet interfaces, TaxPro Enterprise automates the end-to-end outcome:
1. **Ingest Financial Trial Balance** (CSV, NetSuite REST/SuiteQL, or Companies House API).
2. **AI Semantic Account Mapping** (Precedent Engine + Eve subagent swarm with active learning memory).
3. **Deterministic Tax Calculation** (Pure TypeScript math engine, `Decimal.js` monetary primitives for US ASC 740 and UK FRS 102 S29).
4. **Audit-Ready Deliverables** (4-tab `.xlsx` workpaper workbook + Zip package export with audit logs).

---

## 2. Directory & Workspaces Structure

```text
taxpro/
├── apps/
│   ├── api/                          # Hono.js HTTP Backend & Background Workers (Port 3001)
│   │   ├── scripts/
│   │   │   ├── synthetic-seed.ts     # Multi-entity multi-quarter seed generator
│   │   │   ├── run-provision-tests.ts# Automated 12-scenario provision test suite
│   │   │   ├── test-rls-governance.ts# PostgreSQL RLS isolation & fail-closed tests
│   │   │   └── eval/                 # Dual US & UK Benchmark Evaluation Harnesses
│   │   │       ├── run-sec-eval.ts   # US SEC EDGAR 10-K benchmark runner (17.5 bp mean delta, 15/20 evaluated)
│   │   │       └── run-uk-eval.ts    # UK FRS 102 Companies House benchmark runner (9/9 PASS, 1.3 bp mean delta)
│   │   ├── src/
│   │   │   ├── agent/                # Unified Subagent Architecture
│   │   │   │   ├── parser/           # Trial balance CSV/PDF extraction agent
│   │   │   │   ├── mapping/          # Two-stage GL account classification agent
│   │   │   │   ├── explanation/      # Audit-quality tax provision explanation agent
│   │   │   │   ├── audit/            # Risk & compliance audit verification agent
│   │   │   │   ├── orchestrator/     # BullMQ state machine pipeline (state-machine.ts)
│   │   │   │   └── subagents/        # Legacy specialized agents (mapping, audit-defense, credit-miner)
│   │   │   ├── eve/                  # Core Eve LLM Runtime Framework
│   │   │   │   ├── model-client.ts   # Resilient JSON caller (temperature enforcement, prompt versioning)
│   │   │   │   ├── pattern-store.ts  # Tokenized GIN-indexed fuzzy feedback memory
│   │   │   │   └── trace-store.ts    # AI execution step logging (ai_runs, ai_steps)
│   │   │   ├── db/schema/            # Drizzle PostgreSQL schemas (14 tables with RLS)
│   │   │   ├── state/                # TaxProvisionState & assertNotLocked / transitionStage guards
│   │   │   └── modules/              # Auth, Import, Mapping, NetSuite, Provision, Export, Agent
│   └── web/                          # React 18 + Vite Frontend (Port 5173)
│       └── src/
│           ├── pages/
│           │   ├── ProvisionPage.tsx # Single-click run & Excel export
│           │   ├── ReviewDashboard.tsx # Human-in-the-Loop CPA review & governance
│           │   ├── MappingPage.tsx   # Precedent mapping workspace & one-click CPA approval
│           │   └── ...
│           └── components/
│               └── AiFindingsPanel.tsx # Render audit memos, citations & tax credits
└── packages/
    ├── tax-engine/                   # Pure Tax Engine (Zero HTTP/DB deps)
    │   └── src/
    │       ├── index.ts              # calculateJurisdiction() router
    │       ├── current-tax.ts        # ASC 740-10 Taxable Income & Current Tax
    │       ├── deferred-tax.ts       # ASC 740 Deferred Tax Assets/Liabilities
    │       ├── etr-reconciliation.ts # Effective Tax Rate Walk
    │       └── uk-frs102-s29/        # UK FRS 102 S29 Deferred Tax Rules (25% Rate, No Discounting, Note 14)
    └── tax-engine-enterprise/        # Isolated exploratory group/multi-entity/GL-ELT package
                                      #   (44 tests, UNVALIDATED, not wired into any app)
```

---

## 2.5 CI & Security Scanning (2026-08-03)

Four GitHub Actions workflows run on every push/PR to `master` (all green):

- `ci.yml` — Security Scan (Gitleaks advisory + Trufflehog verified secrets),
  Lint & Test against a **fresh Postgres 16 + Redis 7** (bootstrap roles →
  `db:migrate` → `db:seed` → 412 tests → build), Docker Build & Scan (API/Web
  images + Trivy HIGH/CRITICAL SARIF).
- `codeql.yml` — GitHub CodeQL (security + extended).
- `semgrep.yml` — Semgrep `p/security-audit` + `p/typescript` + `p/javascript`
  (0 blocking findings).
- `deps.yml` — OSV-Scanner dependency gate (`osv-scanner-action@v2.3.8`);
  Dependabot enabled for npm / Actions / Docker.

The fresh-DB pipeline caught real bugs in 2026-08-02/03: schema drift
(`provision_runs.approved_by_user_id` was in the TS schema but never migrated —
fixed by idempotent `0012_provision_runs_approval`) and non-byte-reproducible
locked-run packages (zip DOS timestamps now normalized from the run's
`createdAt` in UTC). Prod fail-fast now also covers `TOKEN_ENCRYPTION_KEY`
(mandatory in production), and GCM decryption enforces a 16-byte auth tag.

---

## 3. Core Architectural Principles

1. **Dual-Role PostgreSQL Row-Level Security (RLS)**:
   - `taxpro_migrations` owns schema migrations.
   - `taxpro_app` runs at runtime with `NOBYPASSRLS`.
   - All tenant queries are scoped via `set_config('app.tenant_id', tenantId, true)` inside `withTenantContext`.
2. **Append-Only Audit Trail**:
   - `provision_events` trigger `reject_provision_event_mutation()` rejects any `UPDATE` or `DELETE` attempt.
3. **Pure Zero-Float Precision (`Decimal.js`)**:
   - Monetary values across US ASC 740 and UK FRS 102 calculation paths use `Decimal.js` to eliminate IEEE 754 floating-point drift.
4. **Empirical Ground-Truth Benchmarking**:
   - Engine accuracy is continuously validated against live audited corporate filings:
     - **US SEC EDGAR 10-K Suite:** mean 17.5 bp ETR delta (15/20 filings evaluated, 0 FAIL; skips are filer-data/tie-gate, never counted as validated).
     - **UK Companies House Suite:** 9/9 PASS, mean 1.3 bp ETR variance & 0.0 bp closing deferred variance.
