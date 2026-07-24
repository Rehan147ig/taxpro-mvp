# TaxPro - AI-Native Corporate Tax Provision

TaxPro is an AI-native, outcome-as-a-service platform for ASC 740 corporate income tax provision. Instead of asking tax teams to operate another complex tax SaaS tool, TaxPro turns financial trial balance data into review-ready provision workpapers, audit support, and governance artifacts.

The core model is simple:

```text
Trial balance import
-> Eve AI analysis and account mapping
-> Human review queue
-> Deterministic Decimal.js tax engine
-> Excel workpapers and audit package
-> Finalized provision delivery
```

Eve is the operating layer. She can classify accounts, explain book-tax differences, draft audit-support narratives, identify credit opportunities, and guide review. Final calculations remain deterministic in the TypeScript tax engine.

## What It Does

| Area | Capability |
|---|---|
| Data ingestion | CSV trial balance import and NetSuite connector foundation |
| AI mapping | Eve account classification with fallback rules and active learning |
| Review governance | Provision run lifecycle, review queue, resolve/reject/finalize workflow |
| Tax math | ASC 740 current tax, deferred tax, ETR reconciliation, rollforwards, journal entries |
| Subagents | Mapping agent, audit-defense memo agent, credit-miner agent |
| Deliverables | Excel workpaper export and ZIP package with audit trail |
| Validation | Synthetic provision scenario suite and SEC EDGAR evaluation harness |

## Architecture

```text
apps/web
  React + Vite + Tailwind UI
  Dashboard, Data Sources, Mapping, Provision, Review

apps/api
  Hono API
  Auth, Import, Mapping, NetSuite, Provision, Export
  Eve runtime, subagents, trace logging, pattern memory

packages/tax-engine
  Pure deterministic tax calculation package
  Decimal.js monetary primitives
```

Key invariant:

```text
AI = classification, explanation, review assistance, opportunity detection
Code = tax math, validation, journal entries, export totals
Human = approval, override, final signoff
```

## Eve Runtime

TaxPro does not require Vercel hosting or the Vercel AI SDK. Eve uses a self-hosted OpenAI-compatible runtime:

- `apps/api/src/eve/model-client.ts` - JSON model caller with timeout and retry
- `apps/api/src/eve/trace-store.ts` - `ai_runs` and `ai_steps` logging
- `apps/api/src/eve/pattern-store.ts` - active-learning memory from CPA review decisions
- `apps/api/src/agent/agent.ts` - Eve provision analyzer
- `apps/api/src/agent/subagents/*` - specialized provision subagents

Supported providers are configured through environment variables:

```env
AI_PROVIDER=openai|nvidia|custom
AI_API_KEY=...
AI_BASE_URL=...
AI_MODEL=...
```

## Provision Workflow

`POST /api/provision/run` runs Eve by default.

Use `?direct=true` to bypass Eve and run deterministic provision only.

The workflow creates a `provision_runs` record and tracks:

- period and entity
- input data hash
- mapping version hash
- engine version
- approval status
- review items
- AI findings
- finalization state

If Eve fails or times out, the provision route falls back to deterministic mode and records the exception on the run.

## Review And Governance

The Review page gives tax reviewers a queue for low-confidence or missing mappings.

Important endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/provision/runs` | List provision runs |
| `GET` | `/api/provision/review/queue` | Runs that need review |
| `GET` | `/api/provision/runs/:id/review-items` | Review items for a run |
| `GET` | `/api/provision/runs/:id/ai-findings` | Eve/subagent outputs for UI panels |
| `POST` | `/api/provision/runs/:runId/review-items/:itemId/resolve` | Approve, reject, or override one item |
| `POST` | `/api/provision/runs/:runId/review-items/bulk-resolve` | Bulk resolve open items |
| `POST` | `/api/provision/runs/:runId/finalize` | Lock a reviewed run as finalized |

Human review decisions feed the `classification_patterns` table so similar future accounts can inherit confidence from prior CPA decisions.

## Outputs

| Endpoint | Output |
|---|---|
| `GET /api/provision/results/:id/export` | Excel provision workbook |
| `GET /api/provision/results/:id/package` | ZIP package with workbook, audit trail CSV, and summary |

## Quick Start

Prerequisites:

- Node.js 22+
- Docker
- PostgreSQL and Redis via Docker Compose

```bash
cp .env.example .env
docker compose up -d
npm install --include=dev
npm run db:migrate
npm run db:seed
npm run dev
```

Open:

```text
http://localhost:5173
```

Demo login:

```text
demo@taxpro.ai
TaxProDemo123!
```

## Synthetic Data And Product Tests

Create synthetic multi-entity provision data:

```bash
npm run db:synthetic -w apps/api
```

Run the synthetic provision suite:

```bash
npx -w apps/api tsx scripts/run-provision-tests.ts
```

This validates consolidated and entity-level provision runs across quarterly periods.

## SEC EDGAR Evaluation

TaxPro includes a public-data evaluation harness that compares the tax engine's ETR calculations against audited SEC company facts.

Run online:

```bash
npm run eval
```

Run from cache:

```bash
OFFLINE=1 npm run eval
```

The harness:

- resolves CIKs
- fetches SEC company facts
- extracts pretax income, tax expense, and ETR reconciliation items
- maps XBRL tags into engine inputs
- reports pass, warn, fail, or skip by ETR basis-point delta

This is an evaluation aid, not a substitute for tax professional review.

## Verification

Recommended local checks:

```bash
npm run lint
npm test
npm run build
npx -w apps/api tsx scripts/run-provision-tests.ts
OFFLINE=1 npm run eval
```

Current expected baseline:

- TypeScript lint passes
- Tax-engine unit tests pass
- Production build passes
- Synthetic provision suite passes
- EDGAR eval has no engine failures, with some skips due to public filing data limitations

## Production Priorities

Before serving real customers:

1. Add API integration tests for import, provision, review, finalize, and package export.
2. Strengthen CSV import with a production CSV parser and row-level validation report.
3. Store generated packages in object storage with immutable links.
4. Add role-based access control for preparer, reviewer, admin, and partner roles.
5. Add prompt/output redaction and retention controls.
6. Move from raw schema runner to versioned migrations.
7. Expand public-data eval with curated SEC filings and manually verified ground truth.
8. Add reviewer signoff certificates and locked run snapshots.

## Positioning

TaxPro is best positioned as:

```text
AI-assisted ASC 740 provision delivery for lean corporate tax teams.
```

The customer outcome is not "another dashboard." The outcome is a reviewed provision package that a tax team can use, inspect, defend, and deliver.
