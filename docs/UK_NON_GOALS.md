# TaxPro — UK Non-Goals (2026)

This document is the explicit scope contract for the UK-first product. If a
capability is not listed here or in `docs/UK_COVERAGE_MATRIX.md`, it is not
claimed.

**Date:** 2026-08-04

---

## 1. Hard non-goals (will not be implemented now, in any form)

| # | Non-goal | Why |
|---|---|---|
| 1 | **Direct HMRC filing / submission** | TaxPro produces filing-ready handoff artefacts (CT600, iXBRL, CTO XML, MTD readiness). Submission is performed by the accounting firm or a recognised filing tool. No "filed by TaxPro" claim, ever. |
| 2 | **VAT MTD (Making Tax Digital for VAT)** | Different product surface; out of scope for the corporation-tax provision wedge. |
| 3 | **Broad international tax** (permanent establishments, transfer pricing, WHT, DTT networks) | The UK direct-tax wedge must be deep, not wide. |
| 4 | **Generic AI chat / tax Q&A assistant** | AI output is structured, validated, source-cited and reviewable within the workflow — never a free-form tax advisor. |
| 5 | **Autonomous/black-box tax computation** | AI never silently alters calculations, rules, customer data, approval state or filing status. Deterministic engine is the source of truth. |
| 6 | **"Fake" connector integrations** (no real API behind a UI button) | Only real, credential-backed integrations are listed; the connector interface is implemented as code exists. |
| 7 | **New empty packages for diagram symmetry** | Packages are extracted only where a real ownership boundary exists (see `docs/UK_PRODUCT_ARCHITECTURE.md` §2.1). |

## 2. Deferred non-goals (deliberately later, not silently "partial")

| # | Item | Trigger for reconsideration |
|---|---|---|
| 1 | **UK group relief end-to-end** | Prototype exists in `tax-engine-enterprise` (UNVALIDATED). Wired only after external tax-professional review and real group-case validation. |
| 2 | **US ASC 740 workstream** | Dormant behind `TAXPRO_ENABLE_US=true`. Preserved in full (code, tests, evals) as future optionality; hidden from default UX, onboarding and demo data. |
| 3 | **50-state US tax rule engine** | Same flag and validation bar as the US workstream. |
| 4 | **HMRC MTD-for-CT submission** | CT MTD API is still private beta; re-evaluated when HMRC opens the channel and a pilot partner requests it. |
| 5 | **Direct company secretarial / Companies House filing** | Companies House import exists (data in); filings stay with the firm. |

## 3. What "filing-ready handoff" means (and does not mean)

**Means:** validated CT600 box figures (HMRC-derived rule validator), iXBRL
instance/inline documents (FRS 102 taxonomy lock + structural conformance
validator), CTO GovTalk XML, MTD readiness gate, R&D claim package, and a
signed evidence package (workbook + audit trail + manifest with SHA-256
hashes) — all deterministic, reproducible and locked-run immutable.

**Does not mean:** that TaxPro filed anything, that HMRC/Companies House
accepted anything, or that no professional review is required. External
tax-professional review, security review and real pilot validation are
mandatory gates before any "production-ready" or "filing-ready" claim
(see `docs/PRODUCTION_READINESS_REPORT.md` and `docs/EXTERNAL_REVIEW_BRIEF.md`).

## 4. Honesty rules

1. Unsupported tax cases become **review items**, never silent amounts.
2. Coverage is claimed only via the matrix (`docs/UK_COVERAGE_MATRIX.md`).
3. Status changes ship with code + test + doc changes in the same commit.
4. "Skipped" or "dormant" never reads as "validated".
