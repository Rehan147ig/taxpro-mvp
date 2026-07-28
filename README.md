# TaxPro Enterprise — Multi-Jurisdiction ASC 740 & FRS 102 Corporate Tax Provision Platform

TypeScript | Hono.js | React 18 | PostgreSQL RLS | Vercel AI SDK | Superlog OpenTelemetry

**US ASC 740 EDGAR Benchmark** | **UK FRS 102 Benchmark**

TaxPro Enterprise turns financial trial balance data into review-ready corporate tax provisions, audit support narratives, and locked governance packages across US (ASC 740) and UK (FRS 102 Section 29) tax regimes.

Instead of asking corporate tax teams to operate another complex enterprise software suite or rely on fragile Excel spreadsheets, TaxPro Enterprise uses an **Outcome-as-a-Service (OaaS)** model:

**AI Subagents Draft & Explains → Deterministic Math Calculates → Human CPAs Approve & Lock**

---

## 🏛️ Executive Summary & YC Thesis

Corporate tax provision is a **$12B+ global market** currently split between two legacy options:

- **Legacy Enterprise Software (ONESOURCE, Longview):** Expensive ($50k–$200k+/yr), rigid, and lacks modern AI automation.
- **Excel Workpapers:** Highly error-prone, impossible to audit cleanly across multi-entity corporations, and fragile.

### Core Principle

- **AI prepares, recommends, explains, and drafts.**
- **Deterministic tax code (`Decimal.js`) calculates official financial results.**
- **Humans approve official decisions.**
- **Locked runs cannot be mutated.**
- **Every material action is fully attributable.**
- **Tenant data remains isolated at the PostgreSQL database layer.**

---

## 📐 Architecture & Workflow

```text
flowchart TD
    A[Trial Balance Ingestion CSV / NetSuite / Companies House API] --> B[BullMQ Auto-Mapping Queue]
    B --> C{Precedent Engine}
    C -->|1. Active Precedent| D[Exact Precedent Match]
    C -->|2. Token Pattern| E[Classification Pattern Match]
    C -->|3. Fallback Rules| F[Rule-based Fallback]
    
    D & E & F --> G[Draft Tax Mappings]
    G --> H[CPA Review Dashboard & Staging Gate]
    
    H -->|One-Click Approve / Override| I[Active Precedent Memory]
    H -->|Submit for Approval| J[Partner Review & Sign-Off]
    
    J --> K[Dual Tax Engine Router @taxpro/tax-engine]
    K -->|US Jurisdiction| L[US ASC 740 Engine: Current/Deferred Tax, MACRS, ETR Walk]
    K -->|UK Jurisdiction| M[UK FRS 102 S29 Engine: 25% Rate, No Discounting, Note 14]
    
    J -->|Partner Lock| N[Locked Immutable Provision Run]
    N --> O[Excel Workpaper & Audit ZIP Package Export]
```

### Key Technical Invariants

```text
AI       = Account classification, explanation, review escalation, credit mining
Engine   = ASC 740 & FRS 102 S29 tax math, MACRS depreciation, journal entries, workpaper export
Human    = Segregation-of-duties review, partner sign-off, locking
Database = PostgreSQL Row-Level Security (NOBYPASSRLS runtime role + append-only audit log)
```

---

## 🎯 Empirical Benchmark Validation Results

TaxPro Enterprise includes dual automated evaluation harnesses (`npm run eval` and `npm run eval:uk`) that benchmark the tax calculation engine against audited public company disclosures.

### US SEC EDGAR Benchmark (ASC 740)

```text
SEC EDGAR Accuracy Benchmark (12 Public 10-K Filings)
========================================================================================================================
Company                      Ticker   Disclosed ETR   Calculated ETR   Delta (bp)   Status   Notes
------------------------------------------------------------------------------------------------------------------------
Church & Dwight Co.          CHD      21.45%          21.23%           22 bp        PASS     Matched audited ETR
Paycom Software Inc.         PAYC     18.60%          18.66%            6 bp        PASS     Exact match on R&D credits
Rollins, Inc.                ROL      24.10%          24.43%           33 bp        WARN     State apportionment delta
Pool Corporation             POOL     23.80%          22.94%           86 bp        WARN     Stock comp timing difference
Tyler Technologies, Inc.     TYL      19.20%          20.20%          100 bp        WARN     Sec 174 amortization
A.O. Smith Corporation       AOS      22.10%          22.42%           32 bp        WARN     Foreign tax credit delta
------------------------------------------------------------------------------------------------------------------------
Mean ETR Variance: 46.5 basis points (<0.50% total deviation across evaluable filings)
Failures (>100bp): 0 companies
Result: Exit Code 0 (Passed Benchmark)
```

### UK Companies House Benchmark (FRS 102 Section 29)

```text
UK FRS 102 Benchmark Evaluation Harness (`npm run eval:uk`)
========================================================================================================================
Company                      CH Number   Disclosed ETR   Calculated ETR   ETR Delta   Deferred Closing   Status
------------------------------------------------------------------------------------------------------------------------
Greggs plc                   00502851    24.80%          24.75%           5 bp        0 bp (100% match)  PASS
British Telecomm (BT plc)    01800000    17.40%          17.46%           6 bp        0 bp (100% match)  PASS
------------------------------------------------------------------------------------------------------------------------
Mean ETR Variance: 5.5 basis points (<0.06% total deviation across populated UK filings)
Mean Deferred Closing Variance: 0.0 basis points (100% exact balance match)
Result: Exit Code 0 (Passed Benchmark)
```

---

## 🔒 Security & Multi-Tenant Governance

TaxPro Enterprise enforces defense-in-depth tenant boundary isolation and auditability:

1. **Dual-Role PostgreSQL Setup (`bootstrap-roles.sql`):**
   - `taxpro_migrations`: Schema owner role for Drizzle migrations.
   - `taxpro_app`: Runtime application login role with `NOBYPASSRLS` enforced.

2. **Strict Row-Level Security (RLS):**
   - All 12 tenant-owned tables use strict policies: `USING (tenant_id = app_current_tenant_id())`.
   - Transaction-scoped `set_config('app.tenant_id', tenantId, true)` inside `withTenantContext`.
   - Missing tenant context fails closed (0 rows returned, writes rejected).

3. **Append-Only Audit Trail (`provision_events`):**
   - Database trigger `reject_provision_event_mutation()` rejects any `UPDATE` or `DELETE` on event records.
   - Table privileges for `UPDATE`, `DELETE`, `TRUNCATE` are explicitly revoked from `taxpro_app`.

4. **Segregation of Duties:**
   - Partner sign-off enforces `submittedByUserId !== user.userId` and `requestedByUserId !== user.userId`.
   - Locked runs block modifications with `409 Conflict`.

---

## 📦 Monorepo Structure

```text
taxpro/
├── apps/
│   ├── api/                     # Hono.js REST API Server & Background Workers
│   │   ├── src/
│   │   │   ├── agent/           # Unified Agent Architecture (parser, mapping, audit, explanation, orchestrator)
│   │   │   ├── config/          # Dual DB pools, env schema, runtime security validation
│   │   │   ├── db/              # Drizzle ORM schemas & versioned SQL migrations
│   │   │   ├── eve/             # Vercel AI SDK model client, trace store, pattern store
│   │   │   ├── lib/             # Crypto, JWT auth, RBAC middleware, Superlog OTel
│   │   │   ├── modules/         # Auth, Import, Mapping, NetSuite, Provision, Export, Agent
│   │   │   ├── state/           # TaxProvisionState & immutability guards
│   │   │   └── index.ts         # Server entrypoint with graceful shutdown
│   │   └── scripts/             # Governance tests, auto-mapping flow tests, US/UK eval harnesses
│   │
│   └── web/                     # React 18 SPA Frontend
│       └── src/
│           ├── api/             # Typed API client
│           ├── components/      # Governance stepper, AI findings panel, provenance badges
│           └── pages/           # Dashboard, Mapping, Provision, Review Dashboard, Connections
│
└── packages/
    └── tax-engine/              # Pure ASC 740 & FRS 102 S29 Tax Engine (Decimal.js exact math)
        └── src/                 # Current tax, deferred tax, ETR walk, MACRS depreciation, UK rules
```

---

## ⚡ Quick Start & Local Demo Setup

### Prerequisites

- Node.js 22+
- Docker Desktop (for PostgreSQL 16 & Redis containers)

### 1. Start Services & Install Dependencies

```bash
git clone https://github.com/Rehan147ig/taxpro-mvp.git
cd taxpro-mvp
cp .env.example .env
docker compose up -d
npm install
```

### 2. Run Migrations & Seed Demo Data

```bash
npm run db:migrate -w apps/api
npm run db:synthetic -w apps/api
```

### 3. Launch Development Servers

```bash
npm run dev
```

Open your browser to:

- Frontend SPA: http://localhost:5173
- API Health: http://localhost:3001/api/health

### Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Admin / Partner** | `demo@taxpro.ai` | `TaxProDemo123!` |

---

## 🧪 Verification & Test Commands

```bash
# Typecheck all packages
npx -w apps/api tsc --noEmit; npx -w apps/web tsc --noEmit

# Run PostgreSQL RLS Governance Integration Tests
npx -w apps/api tsx scripts/test-rls-governance.ts

# Run Auto-Mapping Flow Integration Tests
npx -w apps/api tsx scripts/test-auto-mapping-flow.ts

# Run ASC 740 Tax Calculation Engine Suite
npx -w apps/api tsx scripts/run-provision-tests.ts

# Run US SEC EDGAR Public 10-K Benchmark Harness
OFFLINE=1 npm run eval

# Run UK FRS 102 Companies House Benchmark Harness
npm run eval:uk
```

---

## 📄 License

MIT License. Built for enterprise ASC 740 & FRS 102 Section 29 corporate tax provision automation.
