# TaxPro — Comprehensive Knowledge Transfer (KT) for Codex & AI Engineers

---

## 1. Executive Summary & Product Architecture

TaxPro is an **AI-Native Outcome-as-a-Service (OaaS) Direct Corporate Tax Platform** designed for ASC 740 income tax provision workflows. 

### Fundamental Operating Model
Instead of selling complex SaaS spreadsheet interfaces, TaxPro automates the end-to-end outcome:
1. **Ingest Financial Trial Balance** (CSV or NetSuite REST/SuiteQL).
2. **AI Semantic Account Mapping** (Eve runtime with active learning memory).
3. **Deterministic Tax Calculation** (Pure TypeScript math engine, `Decimal.js` monetary primitives).
4. **Audit-Ready Deliverables** (4-tab `.xlsx` workpaper workbook + Zip package export with audit logs).

---

## 2. Directory & Workspaces Structure

```
taxpro-mvp/
├── apps/
│   ├── api/                          # Hono.js HTTP Backend (Port 3001)
│   │   ├── scripts/
│   │   │   ├── schema.ts             # Raw Drizzle DDL migration runner
│   │   │   ├── synthetic-seed.ts     # Multi-entity multi-quarter seed generator
│   │   │   ├── run-provision-tests.ts# Automated 12-scenario provision test suite
│   │   │   └── eval/                 # SEC EDGAR 10-K Ground Truth Evaluation Harness
│   │   │       ├── edgar.ts          # SEC CIK resolution + companyfacts disk cache
│   │   │       ├── ground-truth.ts   # XBRL pretax & ETR reconciliation extractor
│   │   │       ├── xbrl-map.ts       # SEC XBRL tax tag mapping rules
│   │   │       └── run-eval.ts       # Ground-truth evaluation runner
│   │   ├── src/
│   │   │   ├── agent/                # Eve Agent Tools & Subagent Swarm
│   │   │   │   ├── agent.ts          # Main Eve AI Orchestrator
│   │   │   │   ├── instructions.md   # Core system prompt & guidelines
│   │   │   │   ├── subagents/
│   │   │   │   │   ├── mapping-agent.ts # Two-stage GL classification (COGS/OpEx -> IRC)
│   │   │   │   │   ├── audit-defense.ts # M-1 audit technical memo generator
│   │   │   │   │   └── credit-miner.ts  # Sec 41 / 174 / 179D / 51 credit miner
│   │   │   │   └── tools/            # OpenAI function-calling tools (fetch, math, excel)
│   │   │   ├── eve/                  # Core Eve LLM Runtime Framework
│   │   │   │   ├── model-client.ts   # Resilient JSON caller (2 retries, exponential backoff)
│   │   │   │   ├── pattern-store.ts  # Tokenized GIN-indexed fuzzy feedback memory
│   │   │   │   ├── trace-store.ts    # AI execution step logging (ai_runs, ai_steps)
│   │   │   │   └── hash.ts           # SHA-256 stable input hashing
│   │   │   ├── db/schema/            # 14 Drizzle PostgreSQL schemas
│   │   │   └── modules/              # Auth, Import, Mapping (BullMQ), NetSuite, Provision, Export
│   └── web/                          # React 19 + Vite + Tailwind Frontend (Port 5173)
│       └── src/
│           ├── pages/
│           │   ├── ProvisionPage.tsx # Single-click run & Excel export
│           │   ├── ReviewDashboard.tsx # Human-in-the-Loop CPA review & governance
│           │   └── ...
│           └── components/
│               └── AiFindingsPanel.tsx # Render audit memos, citations & tax credits
└── packages/
    └── tax-engine/                   # Pure Calculation Engine (Zero HTTP/DB deps)
        └── src/
            ├── current-tax.ts        # ASC 740-10 Taxable Income & Current Tax
            ├── deferred-tax.ts       # ASC 740-30 Temporary Differences, DTAs, DTLs
            ├── rollforward.ts        # DTA/DTL/NOL Rollforward Schedules
            ├── etr-reconciliation.ts # ETR Reconciliation & Statutory Walk
            └── journal-entries.ts    # Proposed Provision Journal Entries (PJs)
```

---

## 3. Key Design Patterns & Invariants

> [!IMPORTANT]
> **1. Decimal Precision Boundary Layer (`provision-calculator.ts`)**
> Never perform financial arithmetic using standard JS `number` primitives. All calculations in `@taxpro/tax-engine` rely on `Decimal.js`. Use `money()` and `rate()` helpers when passing numbers to the engine to eliminate floating-point drift.

> [!NOTE]
> **2. Active Learning Pattern Store (`classification_patterns`)**
> When a user overrides a tax classification, `recordClassificationPattern()` tokenizes the account title into n-grams stored in a PostgreSQL `JSONB` array indexed with a GIN index (`account_name_tokens`). Subsequent provision runs execute `findSimilarPatterns()` using Jaccard similarity scoring to auto-approve recurring GL accounts.

> [!TIP]
> **3. Multi-Agent Execution (`subagents/`)**
> The Eve runtime triggers 3 subagents concurrently via `Promise.allSettled` in `provision.routes.ts`:
> - `mapping-agent`: Refines GL categories and attaches IRC section citations (Sec 274, 162, 174).
> - `audit-defense`: Drafts technical audit memos with line-by-line ETR walk driver rationales.
> - `credit-miner`: Identifies tax credit opportunities (Sec 41 R&D, Sec 174 R&E, Sec 179D Energy, Sec 51 WOTC).
> All subagent steps log input/output JSON and timing into `ai_runs` and `ai_steps`.

> [!CHECKMARK]
> **4. Resilient Fallback Engine**
> By default, `POST /provision/run` executes Eve AI analysis. If the LLM provider (NVIDIA NIM / OpenAI) fails or times out, the endpoint automatically degrades to the deterministic direct path without throwing HTTP 500 errors.

---

## 4. How To Run & Test

### 1. Infrastructure Setup
```bash
# Copy env and start Postgres (5432) + Redis (6379)
cp .env.example .env
docker compose up -d

# Apply schema migrations & seed synthetic dataset
npm run db:migrate
npm run db:synthetic
```

### 2. Run Dev Servers
```bash
npm run dev
# API runs on http://127.0.0.1:3001
# Web runs on http://127.0.0.1:5173
```
**Demo login:** `demo@taxpro.ai` / `TaxProDemo123!`

### 3. Verification Suites
```bash
# Run unit tests in tax-engine (49 tests)
npm test

# Run 12-scenario automated provision test suite
npx -w apps/api tsx scripts/run-provision-tests.ts

# Run SEC EDGAR 10-K Ground-Truth Evaluation
npx -w apps/api tsx scripts/eval/run-eval.ts
```

---

## 5. Roadmap & What To Build Next (Hand-off to Codex)

1. **Phase 2 (CPA Review UX & Governance)**:
   - Enhance `ReviewDashboard.tsx` with a split-screen layout (Left: GL trial balance lines with inline tax overrides; Right: Eve Assistant + `AiFindingsPanel`).
   - Implement governance state transitions: `Draft` $\rightarrow$ `Pending Review` $\rightarrow$ `Partner Approved` $\rightarrow$ `Locked/Finalized`.
2. **Phase 3 (NetSuite Journal Entry Writeback)**:
   - Implement `POST /netsuite/post-journal-entry` to transmit proposed provision JEs directly back into NetSuite.
3. **Phase 4 (State Income Tax & Multi-Currency)**:
   - Add US State Apportionment formulas (single-sales factor) and ASC 830 foreign currency translations.
