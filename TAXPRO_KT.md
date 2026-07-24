# TaxPro — Knowledge Transfer (KT) for AI Coding Agents

## 1. What Is TaxPro

TaxPro is an **AI-native direct corporate tax platform** that automates ASC 740 tax provision workflows from ERP, warehouse, and spreadsheet financial data. It sits on top of existing finance systems and provides an intelligence layer that connects, imports, maps, calculates, and documents corporate income tax provisions.

**Long-term vision:** Enterprise Financial Intelligence Layer — start with tax provision, expand into audit, compliance, transfer pricing, Pillar 2, and financial planning — all on a unified canonical tax data model.

**YC narrative:** "AI-native direct tax operations. Import GL data from Excel, ERPs, or warehouses → AI maps your accounts → generates ASC 740 provision workpapers in minutes instead of weeks."

---

## 2. Domain — Direct Corporate Tax (ASC 740)

### What is a Tax Provision?

Every US corporation must calculate its **income tax expense** quarterly and annually for financial reporting. This is called the **tax provision** under ASC 740 (US GAAP). It has two parts:

| Component | What it is | Formula |
|---|---|---|
| **Current Tax** | Tax due on this year's taxable income | (Book Income ± Permanent Differences) × Tax Rate − Credits − NOL |
| **Deferred Tax** | Future tax effects of timing differences | Temporary Differences × Future Enacted Tax Rate |

### Key Concepts

- **Permanent differences** — items recognized differently for book vs tax that never reverse (e.g., tax-exempt interest, non-deductible meals, penalties). Affect current tax only.
- **Temporary differences** — timing differences that eventually reverse (e.g., depreciation methods, bad debt reserves, warranty reserves, deferred revenue). Create Deferred Tax Assets (DTAs) or Deferred Tax Liabilities (DTLs).
- **DTA (Deferred Tax Asset)** — future tax benefit from deductible temporary differences (e.g., NOL carryforward, bad debt reserve).
- **DTL (Deferred Tax Liability)** — future tax obligation from taxable temporary differences (e.g., accelerated tax depreciation).
- **Valuation Allowance** — contra-asset that reduces DTA if it's "more likely than not" (>50%) that the benefit won't be realized.
- **ETR (Effective Tax Rate)** — Total Tax Expense / Book Income. Must be reconciled to the statutory rate (21% for US federal).
- **NOL (Net Operating Loss)** — losses that carry forward to offset future taxable income.
- **Rollforward** — schedule showing opening balance → changes → closing balance for DTAs, DTLs, NOLs, valuation allowances.

### The Annual Cycle

| Period | Activity |
|---|---|
| Q1, Q2, Q3 | Interim provision (estimate YTD tax, file estimated payments) |
| Q4 / Year-End | Full annual provision (most scrutiny, audited) |
| Jan-Mar | Tax return preparation (Form 1120), state returns |
| Ongoing | Audit defense, tax planning, regulatory monitoring |

### Key Market Data

- Tax compliance software market: **$6.5B (2024) → $12.1B (2033)**
- **58%** of tax departments are under-resourced
- **67%** haven't adopted GenAI
- Provision rollforward takes **20-30 hours manually** → **2 minutes with automation**
- Incumbents: Thomson Reuters ONESOURCE ($60K-$500K/yr), CSC Corptax, Bloomberg Tax, Longview

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                     │
│  Dashboard │ Connections │ Mapping │ Provision │ Export  │
└──────────────────────────┬──────────────────────────────┘
                           │ REST API (Hono.js)
┌──────────────────────────▼──────────────────────────────┐
│                    API Layer (apps/api)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │  Auth    │ │ NetSuite │ │ Mapping  │ │ Provision │  │
│  │  Module  │ │Connector │ │ Module   │ │  Module   │  │
│  └──────────┘ └────┬─────┘ └────┬─────┘ └─────┬─────┘  │
│                    │             │              │        │
│  ┌─────────────────▼─────────────▼──────────────▼──────┐│
│  │              Database (PostgreSQL)                  ││
│  │  tenants │ connections │ entities │ accounts       ││
│  │  trial_balance │ tax_mappings │ provision_results  ││
│  └────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                 Tax Engine (packages/tax-engine)         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Current  │ │ Deferred │ │ETR Recon │ │ Roll-     │  │
│  │ Tax Calc │ │ Tax Calc │ │          │ │ forward   │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│  ┌──────────┐ ┌──────────┐                             │
│  │ Journal  │ │ Book-Tax │                             │
│  │ Entries  │ │   Diff   │                             │
│  └──────────┘ └──────────┘                             │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Choice | Why |
|---|---|---|
| HTTP Server | Hono.js | TypeScript-native, lightweight, Zod integration |
| Database | PostgreSQL + Drizzle ORM | Type-safe SQL, migrations, no magic |
| AI/LLM | Provider-agnostic (OpenAI-compatible) | Supports OpenAI, NVIDIA NIM, any OpenAI-compatible API |
| Queue | BullMQ + Redis | Async job processing |
| Auth | JWT + bcrypt | Simple, stateless |
| Secret handling | AES-256-GCM app encryption | ERP credentials encrypted at rest and redacted from API responses |
| Frontend | React + Vite + Tailwind | Fast dev, minimal setup |
| State | Zustand | Lightweight, no boilerplate |
| Monorepo | npm workspaces | Simple, no Turborepo |

---

## 4. Data Model (11 Tables)

### Entity Relationship

```
tenants ──┬── connections (NetSuite OAuth creds per tenant)
          ├── entities (synced NetSuite subsidiaries)
          ├── accounts (synced chart of accounts)
          ├── trial_balance (period-level GL balances)
          ├── tax_mappings (AI-suggested + human-overridden account→tax category)
          ├── provision_results (top-level output per period)
          └── users (auth, scoped to tenant)
```

### Core Tables

**`tenants`** — Multi-tenant customers. Stores name, slug, default tax rate, fiscal year end.

**`connections`** — NetSuite OAuth 1.0 credentials per tenant. Consumer key/secret, token id/secret, realm, base URL. Sync status tracking.

**`entities`** — Synced from NetSuite subsidiaries. External ID, name, type (domestic/foreign), currency, parent entity, tax jurisdiction.

**`accounts`** — Synced from NetSuite chart of accounts. Account number, name, type (Income/Expense/Asset/Liability/Equity), detail type, hierarchy.

**`trial_balance`** — Period-level GL data per entity+account. Debit, credit, net balance. Source tracking (csv/netsuite/adjustment/etc.).

**`tax_mappings`** — Maps accounts to canonical tax categories. Versioned (human overrides create new versions). Tracks AI confidence score, explanation, override reason. Supports permanent/temporary/no_diff treatments.

**`provision_results`** — Output of provision calculation per period. Current/deferred/total tax expense, book income, ETR, statutory rate, tax payable, valuation allowance.

### Canonical Tax Account Types

```
Permanent Differences:
  PERM_MEALS_ENTERTAINMENT, PERM_PENALTIES_FINES, PERM_DIVIDENDS_RECEIVED_DEDUCTION,
  PERM_LIFE_INSURANCE, PERM_TAX_EXEMPT_INTEREST, PERM_NONDEDUCTIBLE_GOODWILL, PERM_OTHER

Temporary Differences (Timing):
  TEMP_DEPRECIATION, TEMP_AMORTIZATION, TEMP_ACCELERATED_DEPRECIATION,
  TEMP_BONUS_DEPRECIATION, TEMP_SECTION_179, TEMP_RESEARCH_CREDIT,
  TEMP_BAD_DEBT_RESERVE, TEMP_INVENTORY_RESERVE, TEMP_WARRANTY_RESERVE,
  TEMP_DEFERRED_REVENUE, TEMP_ACCRUED_LIABILITIES, TEMP_PENSION,
  TEMP_NOL_CARRYFORWARD, TEMP_TAX_CREDIT_CARRYFORWARD, TEMP_OTHER

No Difference:
  NODIFF_CASH, NODIFF_AR, NODIFF_AP, NODIFF_REVENUE, NODIFF_SALARIES,
  NODIFF_RENT, NODIFF_UTILITIES, NODIFF_OTHER
```

---

## 5. Module Breakdown

### 5.1 NetSuite Connector (`modules/netsuite/connector/`)

**OAuth 1.0 Signing (`auth.ts`)**
NetSuite uses OAuth 1.0 (not OAuth 2.0). Every request requires HMAC-SHA1 signature.
- Generates nonce + timestamp
- Builds signature base string: `METHOD & URL & PARAM_STRING`
- Signs with HMAC-SHA1 using consumer_secret & token_secret
- Returns full Authorization header

Connection secrets are encrypted before insert and decrypted only inside the sync orchestrator. API responses return redacted placeholders for keys and tokens.

**REST Client (`client.ts`)**
- Wraps OAuth signing onto every request
- Rate limit handling (429 → retry after Retry-After header)
- SuiteQL query support for trial balance data
- Methods: `getSubsidiaries()`, `getChartOfAccounts()`, `querySuiteQL()`, `getTrialBalance()`

**Sync Orchestrator (`sync-orchestrator.ts`)**
- Pulls subsidiaries → inserts/updates `entities` table
- Maps NetSuite account types (e.g., "Bank" → "Asset")
- Pulls COA → inserts/updates `accounts` table
- Pulls trial balance via SuiteQL → `trial_balance` table
- Returns sync metrics

### 5.1a Universal GL Import (`modules/import/`)

The MVP no longer depends on a live NetSuite sandbox. The universal import module accepts trial balance CSV content and normalizes it into the same canonical tax data model used by ERP connectors.

**Endpoints:**
- `GET /api/import/trial-balance/template` — returns a CSV template
- `POST /api/import/trial-balance` — imports rows into `entities`, `accounts`, and `trial_balance`

**Expected columns:**
`entity`, `entityName`, `accountNumber`, `accountName`, `accountType`, `period`, `periodEnd`, `debit`, `credit`, `balance`, `currency`

After import, the module creates fallback tax mappings for newly imported accounts so a user can immediately review mappings and run a provision calculation.

### 5.2 AI Semantic Mapper (`modules/mapping/ai/`)

**Dual-mode architecture:**
1. **LLM mode** — Uses provider-agnostic API (OpenAI-compatible) with structured JSON output
2. **Fallback mode** — Rule-based classification from account name/type patterns (20+ rules)

**Flow:**
- Batches accounts (50/call) to stay within token limits
- Builds system prompt with tax domain rules + user prompt with account data
- For OpenAI: uses `response_format: { type: 'json_object' }`
- For NVIDIA/GLM: uses prompt-level JSON instruction + markdown fence stripping parser
- Returns `{ accountId, taxAccountType, bookTreatment, timingCategory, confidenceScore, explanation }`

**Prompt template** — Expert tax accountant persona classifying accounts into canonical categories.

**Supported providers:**
- OpenAI (gpt-4o-mini, gpt-4o, etc.)
- NVIDIA NIM (GLM-5.2, Kimi K2.6, Nemotron, DeepSeek, etc.)
- Any OpenAI-compatible API via `custom` provider

### 5.3 Tax Engine (`packages/tax-engine/`)

Pure calculation logic with zero HTTP dependencies. Fully unit-testable.

**Modules:**
- `current-tax.ts` — Book income → permanent adjustments → tax rate → tax payable
- `deferred-tax.ts` — Temporary differences × enacted rate → DTA/DTL, aggregate by category
- `book-tax-diff.ts` — Compute differences from trial balance + tax mappings
- `rollforward.ts` — Generate deferred tax rollforward, NOL rollforward, credit rollforward, valuation allowance rollforward
- `etr-reconciliation.ts` — Statutory rate → effective rate with line-item reconciling items
- `journal-entries.ts` — Generate proposed current tax, deferred tax, and valuation allowance journal entries
- `constants.ts` — US federal rate (21%), state rates, MACRS depreciation tables, Section 179 limit

**Test status:** 5 tests, all passing.

### 5.4 Provision Orchestrator (`modules/provision/provision.routes.ts`)

The `POST /provision/run` endpoint orchestrates the full flow:
1. Load tenant config (tax rates)
2. Load entities + trial balance data
3. Load tax mappings
4. Group TB by account → compute book income
5. Classify into permanent/temporary differences
6. Call current tax engine
7. Call deferred tax engine
8. Call rollforward generator
9. Call ETR reconciliation
10. Call journal entry generator
11. Save `provision_results` to DB
12. Return full summary

### 5.5 Frontend (`apps/web/src/pages/`)

Simple React SPA with hash-based routing (no router library dependency for MVP):

| Page | What it does |
|---|---|
| `LoginPage` | Register / login with JWT |
| `Dashboard` | Stats cards (connections, mappings, provisions) + getting started checklist |
| `ConnectionsPage` | CRUD for NetSuite OAuth connections + Sync Now button |
| `MappingPage` | Table of AI-suggested tax mappings with confidence badges, treatment tags |
| `ProvisionPage` | Period picker + Run button → shows summary cards, current/deferred details, ETR table, journal entries |

---

## 6. API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/auth/register` | Register new tenant + user |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/netsuite/connections` | Create NetSuite connection |
| GET | `/api/netsuite/connections` | List connections |
| GET | `/api/netsuite/connections/:id` | Get connection |
| DELETE | `/api/netsuite/connections/:id` | Delete connection |
| POST | `/api/netsuite/connections/:id/sync` | Trigger full sync (subsidiaries → COA → TB) |
| GET | `/api/import/trial-balance/template` | Download universal trial balance CSV template |
| POST | `/api/import/trial-balance` | Import GL trial balance CSV into canonical tax schema |
| GET | `/api/mapping/mappings` | List all tax mappings |
| GET | `/api/mapping/mappings/:accountId` | Get mappings for an account |
| POST | `/api/mapping/mappings/:accountId/override` | Override AI mapping |
| POST | `/api/mapping/mappings/run-ai` | Run AI/fallback mapping on unmapped accounts |
| POST | `/api/provision/run` | Run full provision calculation |
| GET | `/api/provision/results` | List provision history |
| GET | `/api/provision/results/:id/export` | Export provision summary as workpaper CSV |

---

## 7. How to Run

### Prerequisites
- Node.js 22+
- Docker (for PostgreSQL + Redis)
- NVIDIA NIM API key (or any OpenAI-compatible API key)

### Setup
```bash
cd taxpro-mvp

# 1. Configure environment
cp .env.example .env
# Edit .env: set AI_PROVIDER=nvidia, AI_API_KEY, AI_MODEL

# 2. Start infrastructure
docker-compose up -d

# 3. Install deps
npm install --include=dev

# 4. Run migrations
npm run db:generate
npm run db:migrate

# 5. Start dev servers
npm run dev
```

API at `http://localhost:3001`, Web at `http://localhost:5173`.

### Verify
```bash
curl http://localhost:3001/health
# → { "status": "ok", "timestamp": "..." }
```

---

## 8. Testing the AI Mapper

Without a live NetSuite connection, you can test the AI mapper by:

1. **Register** via the UI or API
2. **Create a connection** (can be dummy data for testing)
3. **Seed sample accounts** directly into the DB (or via a seed script)
4. Hit `POST /api/mapping/mappings/run-ai`

The mapper will batch-process accounts through the configured AI provider (NVIDIA/GLM-5.2 by default) and store classifications.

If the AI provider is unavailable, it falls back to rule-based classification (20+ patterns for cash, AR, AP, revenue, salaries, depreciation, bad debt, meals, penalties, R&D, etc.).

---

## 9. Current State & What's Next

### Built ✅

| Module | Status |
|---|---|
| Monorepo structure | Done |
| Tax engine (all 7 calculation modules) | Done, 5/5 tests passing |
| Database schema (11 tables, Drizzle ORM) | Done |
| Auth (register, login, JWT) | Done |
| NetSuite OAuth 1.0 signing utility | Done |
| NetSuite REST API client (subsidiaries, COA, SuiteQL) | Done |
| NetSuite sync orchestrator | Done |
| AI semantic mapper (LLM + fallback) | Done |
| AI provider abstraction (OpenAI, NVIDIA, custom) | Done |
| Provision orchestrator (full calculation flow) | Done |
| Frontend (all 5 pages) | Done |
| TypeScript compilation | Clean |
| Tests | 5/5 passing |

### Not Yet Built (Ordered by Priority)

| Feature | Why Needed |
|---|---|
| **Seed script** with sample chart of accounts + TB data | Demo without live NetSuite |
| **LLM prompt optimization** for GLM-5.2 classification accuracy | Current prompts are OpenAI-optimized; may need tuning for non-OpenAI models |
| **NOL carryforward tracking** across years | Multi-year support |
| **Valuation allowance assessment AI** | Judgment-based, needs ML |
| **Transfer pricing module** | For multinational companies |
| **Pillar 2 (global minimum tax) compliance** | Hot new regulation |
| **State tax apportionment** | Multi-state calculations |
| **Audit-ready workpaper PDF export** | Production-ready output |
| **BullMQ job queue** for async sync | Large NetSuite data volumes |
| **Multi-entity consolidation** | Consolidated provision for subsidiaries |
| **Return-to-provision reconciliation** | Compare provision to filed return |
| **OCI (Other Comprehensive Income) tax effects** | GAAP requirement |

---

## 10. Architecture Decisions & Rationale

1. **tax-engine is a separate package** — Zero HTTP dependencies. Can be unit-tested in isolation, reused in different contexts (CLI, batch jobs, API).

2. **Canonical model is the moat** — Once we handle NetSuite's COA, adding SAP/Oracle/Dynamics is a new connector + same mapper. The hard part (semantic understanding) is already built.

3. **AI suggests, human approves** — Never auto-post to ERP. Tax professionals always review mappings before they're used in calculations. This builds trust and avoids liability.

4. **Provider-agnostic AI** — Not locked into OpenAI. NVIDIA NIM gives access to GLM-5.2, Kimi K2.6, Nemotron, DeepSeek for free/cheap. Swappable via env vars.

5. **Drizzle ORM over Prisma** — Drizzle is lighter, has better type safety for raw SQL, and doesn't generate a client. Better for a startup MVP.

6. **Hono.js over Express** — TypeScript-native, faster, built-in Zod validation, smaller bundle. Better developer experience for API-first apps.

---

## 11. Key Competitors & Differentiation

| Competitor | Focus | TaxPro Difference |
|---|---|---|
| **Sphere (YC W22)** | Indirect tax (sales tax/VAT/GST) for B2B tech | Direct/corporate tax — different problem |
| **Thomson Reuters ONESOURCE** | Enterprise tax provision + compliance | Old, expensive ($60K-$500K/yr), no AI-native features |
| **CSC Corptax** | Enterprise corporate tax | Legacy on-prem, no semantic mapping |
| **Bloomberg Tax** | Tax provision | Add-on to Bloomberg terminal, not standalone |
| **Excel** | Manual workpapers | 20-30 hours → 2 minutes with TaxPro |

---

## 12. YC Application Narrative Draft

**Problem:** Corporate tax departments spend 56% of their time on manual spreadsheet work. 58% are under-resourced. 67% haven't adopted AI.

**Solution:** AI-native tax provision that connects to NetSuite, auto-maps accounts using LLMs, and generates ASC 740 workpapers in minutes.

**Why now:** OECD Pillar 2 and US tax reform (OBBBA 2025) created unprecedented complexity. Incumbents are old/expensive. AI models (GLM-5.2, GPT-4o-mini) are finally good enough for structured financial reasoning.

**Traction:** [TBD — MVP built, testing with early design partners]

**Team:** [TBD]

**Market:** $6.5B tax compliance software market, growing to $12.1B by 2033. 30,000-40,000 US companies that need proper provision software.
