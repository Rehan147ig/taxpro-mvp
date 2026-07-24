# TaxPro — AI-Native Direct Corporate Tax Provision

**Connect any financial data source. AI maps your accounts. ASC 740 provision workpapers in minutes.**

TaxPro is an AI-native platform that automates corporate income tax provision (ASC 740) workflows. It ingests trial balance data from any source (CSV, Excel, NetSuite, QuickBooks, Xero, SAP), uses AI to semantically classify accounts into tax categories, and generates complete provision workpapers — current tax, deferred tax, rollforward schedules, ETR reconciliation, and proposed journal entries.

---

## Quick Start

```bash
# Prerequisites: Docker, Node.js 22+

# 1. Setup
cp .env.example .env                # Edit with your AI API key
docker compose up -d                 # Start PostgreSQL + Redis
npm install --include=dev

# 2. Database
npm run db:migrate                   # Create tables
npm run db:seed                      # (Optional) Load demo data

# 3. Run
npm run dev                          # API: :3001, Web: :5173
```

Open `http://localhost:5173`. **Demo login:** `demo@taxpro.ai` / `TaxProDemo123!`

---

## Architecture

```
Frontend (React + Vite + Tailwind)       ← port 5173
       │ REST API
Backend (Hono.js + TypeScript)           ← port 3001
       │
  ┌────┼────┬────┬────┬────┐
 Auth CSV  NS   AI   Prov Export
       │          │
 PostgreSQL   NVIDIA/OpenAI
 + Redis
       │
 Tax Engine (Pure TypeScript)
 Current │ Deferred │ Rollforward │ ETR │ JE
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full mermaid diagram.

---

## Features

| Feature | Description |
|---|---|
| **CSV/GL Import** | Upload trial balance from any ERP. Auto-detects field names, creates entities + accounts + mappings |
| **NetSuite Connector** | OAuth 1.0 HMAC-SHA1 signing, SuiteQL trial balance queries, encrypted credential storage |
| **AI Account Mapping** | LLM-powered classification (NVIDIA/OpenAI) with rule-based fallback. Human-overridable |
| **Current Tax Calc** | ASC 740-10: book income → permanent differences → federal/state tax → credits → NOL |
| **Deferred Tax Calc** | ASC 740-30: temporary differences × enacted rate → DTA/DTL by category |
| **Rollforward Schedules** | DTA/DTL, NOL, tax credit, and valuation allowance rollforwards |
| **ETR Reconciliation** | Statutory rate → effective rate with line-item explanations |
| **Journal Entries** | Proposed current tax, deferred tax, and valuation allowance JEs |
| **Workpaper Export** | CSV download of provision results |

---

## Tech Stack

| Layer | Choice |
|---|---|
| HTTP Server | Hono.js |
| Database | PostgreSQL 16 + Drizzle ORM |
| AI/LLM | Provider-agnostic (OpenAI, NVIDIA NIM, custom) |
| Queue | BullMQ + Redis 7 |
| Auth | JWT + bcrypt, AES-256-GCM for secrets |
| Frontend | React 19 + Vite + Tailwind CSS + Zustand |
| Monorepo | npm workspaces |
| CI/CD | GitHub Actions |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgres://...` | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | **Production** | — | JWT signing key (min 32 chars) |
| `DATA_ENCRYPTION_KEY` | **Production** | — | AES-256 key for credential encryption (min 32 chars) |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |
| `AI_PROVIDER` | No | `openai` | `openai`, `nvidia`, or `custom` |
| `AI_API_KEY` | Varies | — | API key for the AI provider |
| `AI_MODEL` | No | `gpt-4o-mini` / `z-ai/glm-5.2` | Model name |
| `AI_BASE_URL` | Varies | — | Base URL for the AI provider |
| `PORT` | No | `3001` | API server port |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |

---

## Development

```bash
# Start infrastructure
docker compose up -d

# Start dev servers (hot reload)
npm run dev

# Run tests (5 tests, all passing)
npm test

# TypeScript check
npm run lint

# Build for production
npm run build
```

### Project Structure

```
taxpro-mvp/
├── apps/
│   ├── api/           # Hono.js backend (TypeScript)
│   │   ├── src/config/    # Env, DB, AI config
│   │   ├── src/db/schema/ # 11 Drizzle table definitions
│   │   ├── src/modules/   # Auth, NetSuite, Mapping, Provision, Import
│   │   └── src/lib/       # Errors, middleware, crypto, logger
│   └── web/           # React frontend (Vite + Tailwind)
│       └── src/pages/ # Dashboard, DataSources, Mapping, Provision
├── packages/
│   └── tax-engine/    # Pure calculation logic (no HTTP deps)
│       └── src/       # Current tax, deferred tax, rollforward, ETR, JE
├── infrastructure/    # nginx, docker compose, init scripts
├── scripts/           # First-run setup
└── .github/           # CI/CD pipelines
```

---

## Production Deployment

### 1. Prerequisites

- Docker Engine 24+ on your server
- Docker Compose v2+
- Domain name (optional, for HTTPS)
- AI provider API key (NVIDIA NIM, OpenAI, or custom)

### 2. Configure

```bash
cp .env.example .env
# Edit .env with production values:
#   JWT_SECRET=         ← generate: openssl rand -base64 32
#   DATA_ENCRYPTION_KEY= ← generate: openssl rand -base64 32
#   AI_API_KEY=         ← your NVIDIA/OpenAI key
#   CORS_ORIGIN=https://yourdomain.com
#   NODE_ENV=production
```

### 3. Deploy with Docker Compose

```bash
# Pull and start all services
docker compose -f infrastructure/docker-compose.prod.yml up -d

# Run migrations
docker compose -f infrastructure/docker-compose.prod.yml exec api sh -c \
  'npx drizzle-kit migrate --config=apps/api/drizzle.config.ts'

# (Optional) Seed demo data
docker compose -f infrastructure/docker-compose.prod.yml exec api sh -c \
  'node --import tsx apps/api/src/db/seed.ts'
```

The app will be available at `http://localhost:80`.

### 4. Deploy with GitHub Actions

Push a version tag to trigger the deploy pipeline:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Images are published to `ghcr.io/<your-org>/taxpro-mvp/api` and `.../web`.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/status` | Full status (includes DB check) |
| `POST` | `/api/auth/register` | Register new tenant + user |
| `POST` | `/api/auth/login` | Login, returns JWT |
| `POST` | `/api/netsuite/connections` | Create NetSuite connection |
| `GET` | `/api/netsuite/connections` | List connections |
| `POST` | `/api/netsuite/connections/:id/sync` | Trigger full sync |
| `GET` | `/api/mapping/mappings` | List tax mappings |
| `POST` | `/api/mapping/mappings/run-ai` | Run AI/fallback mapping |
| `POST` | `/api/mapping/mappings/:id/override` | Override a mapping |
| `GET` | `/api/import/trial-balance/template` | Download CSV template |
| `POST` | `/api/import/trial-balance` | Upload trial balance CSV |
| `POST` | `/api/provision/run` | Run provision calculation |
| `GET` | `/api/provision/results` | List provision results |
| `GET` | `/api/provision/results/:id/export` | Export workpaper CSV |

---

## Demo

A demo tenant with sample data is available:

- **URL:** `http://localhost:5173`
- **Email:** `demo@taxpro.ai`
- **Password:** `TaxProDemo123!`

The demo includes 8 accounts covering all tax treatment types (permanent differences, temporary differences, no difference) with pre-loaded AI mappings and trial balance data for FY 2026.

---

## License

MIT
