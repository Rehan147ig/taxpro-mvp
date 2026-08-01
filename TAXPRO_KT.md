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
│   │   │       ├── run-sec-eval.ts   # US SEC EDGAR 10-K benchmark runner (46.5 bp mean variance)
│   │   │       └── run-uk-eval.ts    # UK FRS 102 Companies House benchmark runner (5.5 bp mean variance)
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
    └── tax-engine/                   # Pure Tax Engine (Zero HTTP/DB deps)
        └── src/
            ├── index.ts              # calculateJurisdiction() router
            ├── current-tax.ts        # ASC 740-10 Taxable Income & Current Tax
            ├── deferred-tax.ts       # ASC 740 Deferred Tax Assets/Liabilities
            ├── etr-reconciliation.ts # Effective Tax Rate Walk
            └── uk-frs102-s29/        # UK FRS 102 S29 Deferred Tax Rules (25% Rate, No Discounting, Note 14)
```

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
     - **US SEC EDGAR 10-K Suite:** 46.5 bp mean ETR variance across public 10-Ks.
     - **UK Companies House Suite:** 5.5 bp mean ETR variance & 0.0 bp closing deferred variance across Greggs plc & BT plc.
