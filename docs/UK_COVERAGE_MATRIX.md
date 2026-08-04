# TaxPro — UK FRS 102 Coverage Matrix

**Status:** explicit coverage contract — nothing in this file is implied beyond
what is listed. Unsupported cases become review items, never silent engine
output.
**Date:** 2026-08-04 (updated for Phase C — UK tax-close workbench end-to-end)

Legend:
- **✅ Supported** — deterministic engine or validated export covers it, tested.
- **🟡 Partial** — works for common cases; documented boundary; exceptions go to review.
- **🟠 Manual review only** — engine/AI flags it; a human decides; no amount is produced silently.
- **❌ Out of scope** — not implemented; will not be claimed; see `docs/UK_NON_GOALS.md`.

---

## 1. UK Current Tax (CTA 2010, FRS 102 S29)

| Item | Status | Evidence |
|---|---|---|
| Main rate of corporation tax (25% FY2023+) | ✅ | `uk-frs102-s29/rules.ts` `UK_RATES_BY_FISCAL_YEAR` 2023–2026 |
| Small profits rate (19% ≤ £50k) | ✅ | engine + tests |
| Marginal relief (`3/200 × (U − A)`, CTA 2010 s.18D) | ✅ | engine + `ct600.ts` + CT600 validator (CTM03925) |
| Associated companies adjustment (÷(N+1)) | ✅ | engine accepts associated-company divisor |
| Rate lookup by accounting period (straddling FYs) | 🟡 | FY table keyed on fiscal year; straddling periods flagged, not auto-split |
| Deferred tax recognition (29.14–29.17) | ✅ | recovery check, no discounting |
| Uncertain tax treatments (29.22) | 🟠 | reviewed via review items, not auto-amounted |
| Capital allowances on fixtures | ✅ | book depreciation vs tax written-down value via temporary differences |
| R&D relief (SME/RDEC/intensive) | ✅ figures 🟠 entitlement | credit-miner proposes; amounts deterministic; entitlement is a review decision |

## 2. Deferred Tax (FRS 102 S29)

| Item | Status | Evidence |
|---|---|---|
| Taxable/deductible temporary differences | ✅ | `calculateUkDeferredTax` + tests |
| Undiscounted timing (29.17) | ✅ | engine |
| Probable recovery (29.14) | ✅ | `checkProbableRecovery` + tests |
| Rollforward (opening/closing, reversals) | ✅ | `generateRollforward` |
| Deferred tax on business combinations | 🟠 | review item; no auto-amount |
| Valuation allowance-style recognition | 🟠 | not a UK disclosure; recovery assessment is reviewer-owned |

## 3. ETR Reconciliation (29.87(b) disclosure)

| Item | Status | Evidence |
|---|---|---|
| Statutory-rate walk | ✅ | `calculateETR` + marginal-relief line |
| Permanent-difference lines | ✅ | mapping categories `PERM_*` |
| Tax-rate-change reconciliation | 🟡 | `taxRateChanges` supported; material rate-changes flagged |
| Foreign tax / double-tax relief | 🟠 | review item |

## 4. Losses & Group Relief

| Item | Status | Evidence |
|---|---|---|
| Loss carry-forward utilisation | ✅ | `nolUtilization` path + rollforward |
| Loss relief claims (CTA 2010 Part 4) | 🟠 | claim routing is reviewer-owned |
| Group relief (CTA 2010 Part 5) | 🟠 | engine prototype in `tax-engine-enterprise` (UNVALIDATED, dormant) — not wired; groups are manual-review until validated |

## 5. Supported Adjustments (mapping categories)

| Category | Status |
|---|---|
| No-difference revenue/expense (`NODIFF_*`) | ✅ |
| Temporary: depreciation, bad-debt reserve, deferred revenue, other | ✅ |
| Permanent: meals/entertaining (50%), penalties & fines, other non-deductible | ✅ (US-derived labels reused; UK amounts are reviewer-verified via mapping review) |
| Mixed-purpose / dual-purpose costs | 🟠 manual review |
| Unsupported classification (outside controlled taxonomy) | 🟠 Phase B — `validateUkClassification` → `MANUAL_REVIEW` review item |

## 6. Filing Handoff

| Item | Status | Evidence |
|---|---|---|
| CT600 box set (2016+ layout) + HMRC-derived validator | ✅ | `export/ct600.ts`, `ct600-validation.ts` |
| iXBRL instance + inline (FRS 102 taxonomy lock) | ✅ | `export/ixbrl.ts`, `ixbrl-validation.ts` |
| CTO GovTalk XML (Corporation Tax Online) | ✅ export only | `export/cto-xml.ts` |
| MTD for CT readiness gate | ✅ no submission | `mtd/mtd-client.ts` |
| R&D claim package | ✅ figures 🟠 entitlement | `export/rd-claim.ts` |
| Evidence package (workbook + trail + manifest SHA-256) | ✅ | `export/package-export.ts` |
| Direct HMRC filing | ❌ | out of scope by contract |

## 7. Data Hub

| Item | Status |
|---|---|
| CSV/XLSX trial-balance import + validation | ✅ |
| Xero connector (UK, GBP) | ✅ real OAuth |
| NetSuite connector | ✅ generic ERP (also UK-usable) |
| QuickBooks Online connector | ✅ real OAuth — **UK data source** (defaults: `UK_FRS102`, GBP) since Phase A follow-up; US-specific sync params only with `TAXPRO_ENABLE_US=true` |
| Companies House import | ✅ |
| Entity groups / consolidated entity model | ✅ Phase B (`entity_groups`, `entities.group_id`) |
| Accounting periods + tax periods (CTA 2010 s.10) | ✅ Phase B — 3–12 months standard; non-standard flagged → review item, never silent |
| Prior-year CT600/computation/loss/PDF artefact store | ✅ Phase B — `source_documents` metadata (SHA-256, provenance, versioning, `is_current`) |
| Object storage abstraction | ✅ Phase B — local backend (`TAXPRO_STORAGE_BACKEND=local`), interface ready for S3-class backends |

## 8. Governance

| Item | Status |
|---|---|
| Review queue + resolution | ✅ (severity/owner/due-date/evidence-request/waiver: Phase B) |
| Review lifecycle (open → in_progress → waiting_for_evidence → resolved; waiver human-only + reason + append-only audit) | ✅ Phase B |
| Maker-checker + partner sign-off | ✅ |
| Locked-run immutability (409) | ✅ |
| Evidence manifest hashes | ✅ |
| Mapping proposals (AI/rules/import may propose; humans decide; prior-year carry-forward as proposals only) | ✅ Phase B |
| Controlled UK taxonomy (unsupported → `MANUAL_REVIEW`) | ✅ Phase B (`uk-taxonomy.ts`, 12 classes) |
| Rule store with effective dates/source/snapshot/approval/rollback; runs record `rules_used` | ✅ Phase B (`uk_rules`, `provision_runs.rules_used`) |
| Tax Memory (prior-year positions as proposals) | 🟡 carry-forward proposals live (Phase B); broader positions library Phase C/D |
| External filing reference recording | ❌ Phase D |

## 9. Tax-Close Workbench (Phase C — shipped 2026-08-04)

| Item | Status | Evidence |
|---|---|---|
| Workbench setup (entity, FY2026 accounting/tax periods, TB, mappings, run state) | ✅ | `GET /api/workbench/setup`; seeded demo tenant is workbench-ready (standard 2026-01-01 period) |
| Idempotent trial-balance import into a source document + period | ✅ | `POST /api/workbench/import` — `idempotency_key` ledger (`workbench_jobs`), replayed jobs return the prior result; tenant-scoped unique constraint |
| Gated calculation run (deterministic UK engine snapshot) | ✅ | `POST /api/workbench/runs` — blockers gate the run (setup incomplete / mapping coverage / locked runs → blocked response), deterministic result + review items + warnings persisted |
| Unsupported / uncovered items | 🟠 | become review items (`missing_depreciation_metadata`, low-confidence mappings) or gate blockers — never silent engine output |
| Recalculate-as-new-version (lineage) | ✅ | `POST /api/workbench/runs/:id/recalculate` — new versioned run with `parent_run_id`; locked runs reject mutation with 409 |
| Run provenance (source doc, periods, mapping snapshot, assumptions, warnings, `rules_used`) | ✅ | `GET /api/workbench/runs/:id` + Workbench run-detail view |
| Approval / lock gates | ✅ | `workbench-gates.ts` — run gates + approval gates (partner rules, workbench-run awareness; legacy runs exempt); covered by `workbench-gates` unit tests |
| Workbench UI (import → run → recalc → provenance) | ✅ | `apps/web` Workbench page, nav-labelled, recent-runs refresh after run/recalc; covered by the E2E workbench journey |
| Tenant isolation of workbench data | ✅ | `workbench_jobs` RLS (select/insert/update policies, `taxpro_app` has no DELETE/TRUNCATE); E2E cross-tenant probe |
| Workbench-specific limits | 🟡 | NOT HMRC-filing-ready; no CT600 submission or VAT MTD; filing-handoff states + evidence-manifest completion + external filing records are Phase D; mapping decisions remain human-owned |

---

## Review of matrix ownership

- This matrix is the **commercial honesty contract** for the UK pilot.
- Anything a pilot user asks for that is 🟠 or ❌ becomes a documented
  limitation in the pilot runbook — or a review item inside the product —
  before it is promised.
- Status changes require a code change + test + doc change in the same commit.
