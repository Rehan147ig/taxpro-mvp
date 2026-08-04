# TaxPro — UK FRS 102 Coverage Matrix

**Status:** explicit coverage contract — nothing in this file is implied beyond
what is listed. Unsupported cases become review items, never silent engine
output.
**Date:** 2026-08-04

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
| QuickBooks Online connector | ✅ code, **dormant** (US; `TAXPRO_ENABLE_US=true`) |
| Companies House import | ✅ |
| Prior-year CT600/computation/loss/PDF artefact store | ❌ Phase B |
| Object storage abstraction | ❌ Phase B |

## 8. Governance

| Item | Status |
|---|---|
| Review queue + resolution | ✅ (severity/owner/due-date/evidence-request: Phase B) |
| Maker-checker + partner sign-off | ✅ |
| Locked-run immutability (409) | ✅ |
| Evidence manifest hashes | ✅ |
| Rule store with effective dates/source/approval/rollback | ❌ Phase B |
| Tax Memory (prior-year positions as proposals) | ❌ Phase C/D |
| External filing reference recording | ❌ Phase D |

---

## Review of matrix ownership

- This matrix is the **commercial honesty contract** for the UK pilot.
- Anything a pilot user asks for that is 🟠 or ❌ becomes a documented
  limitation in the pilot runbook — or a review item inside the product —
  before it is promised.
- Status changes require a code change + test + doc change in the same commit.
