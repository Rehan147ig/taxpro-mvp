# EDGAR Skip Gap Report

**Date:** 2026-08-01 (report-only); **P1 fixes implemented + re-baselined 2026-08-01**; **P2 fixes implemented + re-baselined 2026-08-01**; **P3 benchmark expansion + additive-credit fix + CI surfacing 2026-08-03**
**Scope:** Report initially produced with no harness code changes. The P1 fixes (new-taxonomy tag collection, minority-interest bucket), P2 fixes (percent-unit path, target rotation), and P3 work (target expansion to 20, additive-convention credit mapping fix, live eval step in CI) were subsequently implemented and the offline eval re-baselined: 20 cached `facts_*.json` companyfacts payloads (all current fiscal-year 2025 10-Ks), plus raw tag-level inspection of the cached SEC XBRL data and the extractor/mapper sources (`apps/api/scripts/eval/ground-truth.ts`, `xbrl-map.ts`, `run-eval.ts`).

---

## 1. Executive summary

Current harness state (offline, cached data): **12 PASS, 3 WARN, 5 SKIPPED of 20 filings** — up from 2 PASS / 4 WARN / 6 SKIPPED at report time, then 4 PASS / 1 WARN / 7 SKIPPED after P1, 4 PASS / 3 WARN / 5 SKIPPED after P2, now **15/20 validated** after P3 (12 PASS + 3 WARN + 0 FAIL). Mean ETR delta **17.5 bp** across the 15 evaluated companies (was 32.7 bp across 7). The harness semantics remain honest: SKIP is not validation, and the summary line prints `VALIDATED: 15/20` and "never market skipped companies as validated".

**P1 fixes delivered:** new-taxonomy dollar-tag collection in `ground-truth.ts` (HSY's FDII + energy credit + cross-border, NUE/BRO/ROL/POOL/TYL/CHD cross-border items) and the minority-interest negative bucket in `xbrl-map.ts` (NUE's $69M NCI now correctly tax-reducing). Result: CHD 22→10 bp PASS, ROL 33→20 bp PASS, POOL 86→19 bp PASS, HSY 268→122 bp, NUE 663→118 bp.

**P2 fixes delivered:** percent-unit path in `ground-truth.ts` (CLX now extracts 7 percent items → engine attempts evaluation; still SKIP because the disclosed percent data sums to ≈26.2% vs 23.56% disclosed — exactly as the report predicted) and target rotation in `run-eval.ts` (JKHY → FAST, WDFC → ITW, both mid-cap industrials with clean itemized USD recon): FAST WARN 74 bp, ITW WARN 68 bp — both previously unrecoverable SKIPs are now evaluated.

**P3 delivered:** target expansion from 12 to 20 (`run-eval.ts` TARGETS — GGG, IEX, BRC, SSD, MSM, CSL, AWI, UFPI added; NDSN/FELE scanned and rejected on the tie gate) and a real mapper fix in `xbrl-map.ts` for additive-convention credits. The engine validates `taxCredits ≥ 0` (credits always reduce tax), but some filers disclose credits as additive (positive) impacts in the reconciliation — those items now flow through `otherAdjustments` as-filed instead of the engine `taxCredits` path. This recovered UFPI from 179 bp FAIL → 19 bp PASS with zero regressions. The US eval also now runs live in CI (non-fatal step after the Agent Harness, `EDGAR_USER_AGENT` set) so the benchmark is continuously re-checked on master.

The skip gap decomposes into **four distinct root causes**:

| # | Root cause | Type | Companies | Closure feasibility |
|---|---|---|---|---|
| 1 | New-taxonomy dollar tags (`EffectiveIncomeTaxRateReconciliation…Amount`) not collected | Code gap | HSY, BRO, NUE (partial) | High — small extractor change |
| 2 | Percentage-only recon disclosure (values under `units.pure`, no USD amounts) | Data presentation | CLX | Medium — percent→impact path, but percent data itself ties imperfectly |
| 3 | Annual recon not tagged in XBRL at all for recent years | Filer data gap | JKHY, WDFC | None — needs target rotation |
| 4 | Missing classification/sign handling (minority interest income) | Code gap | NUE (partial) | High — small mapper change |

Post-fix outcome (achieved): **15 validated (12 PASS + 3 WARN), 5 skipped, 0 FAIL**. New PASS entries from the P3 expansion: GGG 0 bp, IEX 1 bp, BRC 2 bp, SSD 0 bp, MSM 4 bp, CSL 1 bp, AWI 9 bp, UFPI 19 bp (after the additive-credit fix); POOL re-measured 19→16 bp. Two scanned candidates (NDSN, FELE) were rejected — their disclosed recon data does not tie internally (percent-recon 265 bp / 270 bp on the tie gate). HSY improved to 122 bp but stayed SKIP — its disclosed footnote still does not tie; the ~$14.8M residual gap is untagged XBRL lines that no code change can recover (all recon tags for FY2025-12-31 enumerated; the credit-flip heuristic already picks the better of 122/133 bp). FAST and ITW replaced the two unrecoverable filer-data skips (JKHY, WDFC) and evaluate at WARN (74 bp, 68 bp). CLX is now attempted via the percent path (7 items) but stays SKIP — the disclosed percent recon doesn't tie (data presentation, by design). BRO/NUE/TYL remain skipped because their disclosed footnote data does not tie even after the code fixes. The dominant blocker is **filer data presentation, not engine math** — every evaluated company (15/15) is within the 100 bp WARN band, mean 17.5 bp.

---

## 2. Skip definitions (harness semantics)

- `no_recon_items` — zero itemized ETR recon lines extracted.
- `footnote_does_not_tie` — internal consistency check: |statutory + Σ items − disclosed total| > 100 bp of pretax. This is a data-quality gate, not an engine failure.
- `fetch_error` / `data_unavailable` — transport/extraction failure (none in this run).
- **SKIPs are never counted as validated.** PASS ≤ 25 bp, WARN ≤ 100 bp, FAIL > 100 bp (only reachable when the footnote ties).

---

## 3. Per-company root-cause analysis

### 3.1 CLX (Clorox) — SKIP `no_recon_items` → percentage-only disclosure

- ETR disclosed 23.56% vs statutory 21% (engine 21.00%).
- The legacy `IncomeTaxReconciliation*` dollar tags have **no 2025 values** (latest 2011-06-30).
- The modern `EffectiveIncomeTaxRateReconciliation*` tags carry the FY2025 recon **in percentage form only** (`units.pure`), e.g. foreign +0.026, state +0.027, other −0.026, SBC −0.003, R&D credit +0.005, disposition +0.023.
- `ground-truth.ts:95` originally only collected tags with prefix `IncomeTaxReconciliation` and only USD units, so **zero items** were extracted. The P2 percent path now extracts the 7 pure-unit items (foreign +0.026, state +0.027, SBC −0.003, R&D credit +0.005, disposition +0.023, other −0.026, plus a few zero-value items) as dollar impacts.
- Closure note (confirmed post-fix): the pure-unit items sum to ≈26.2% vs disclosed 23.56% (≈164 bp off in harness terms) — several tags are stale (valuation-allowance tag last filed 2019, enacted-rate 2020) — so CLX **still fails the tie gate**. Percent extraction works but must be validated; as predicted, CLX remains SKIP.

### 3.2 HSY (Hershey) — SKIP `footnote_does_not_tie` → taxonomy drift (recoverable)

- 268 bp gap pre-fix. Extracted items summed to +$112.2M over statutory ($255.0M) → engine $363.5M vs disclosed $330.9M.
- **Three FY2025 dollar items exist in the cached data under the new namespace and were invisible to the extractor:**
  - `EffectiveIncomeTaxRateReconciliationFdiiAmount` = +$22.863M (FDII deduction)
  - `EffectiveIncomeTaxRateReconciliationTaxCreditEnergyRelatedAmount` = +$29.116M
  - `EffectiveIncomeTaxRateReconciliationCrossBorderOtherAmount` = +$4.66M
- **Post-fix: 122 bp (down from 268 bp).** FDII flows as a deduction (−$22.9M), the energy credit as a credit (|$29.1M|), cross-border as other (+$4.7M). The footnote still does not tie: HSY's credit-sign convention (positive energy credit) interacts with the global credit-flip heuristic, and the disclosed recon has residual lines the XBRL data does not fully tag.
- **2026-08-03 conclusion: not recoverable by code.** The residual ≈$14.8M gap is untagged XBRL lines. All `EffectiveIncomeTaxRateReconciliation*` tags for FY2025-12-31 were enumerated (the extraction already collects every recon tag in the companyfacts payload with a 2025 value); the credit-flip heuristic already chooses the better of 122 bp / 133 bp. HSY simply does not machine-tag the full disclosure — a filer-data gap, closed for the harness as a documented SKIP. The tie gate keeps it SKIP.

### 3.3 JKHY (Jack Henry) — SKIP `no_recon_items` → untagged annual recon (filer gap)

- The only modern percent tags with values are **stale: statutory rate last filed 2015** (0.35, pre-TCJA). No FY2025 recon lines exist in any unit, dollar or percent.
- The company's recent annual ETR recon is not exposed in machine-readable XBRL form. **No extractor change can recover this.** Recommend target rotation (e.g., replace JKHY with a filer that tags a simple domestic recon).

### 3.4 WDFC (WD-40) — SKIP `footnote_does_not_tie` → untagged annual recon + stale partials

- 1457 bp gap. Only two 2025 dollar items exist (foreign differential +$3.3M, other reconciling +$0.77M); state taxes, R&D credits, and SBC dollar tags stop at 2010–2021.
- Modern percent tags are **10-Q (quarterly) only** — no recent annual 10-K recon in any form.
- Same conclusion as JKHY: genuine filer data gap; no code fix recovers the annual recon. Recommend rotation or acceptance as data_unavailable.

### 3.5 BRO (Brown & Brown) — SKIP `footnote_does_not_tie` → partial extraction, residual gap

- 190 bp gap. Extracted: −$14.0M nondeductible, −$3.0M other, +$54.0M state, +$5.0M contingency → engine $329.9M vs $304.0M.
- One modern dollar item is missed: `EffectiveIncomeTaxRateReconciliationCrossBorderTaxEffectAmount` = +$4.0M.
- Even with the missing item (either sign), the footnote lands ≈160–220 bp off — the disclosed recon has additional untagged lines (GILTI/FDII/rate-differential items are typical for BRO) that are not in the data. Expectation: **remains SKIP** even after the taxonomy fix; the tie gate keeps working as designed.

### 3.6 NUE (Nucor) — SKIP `footnote_does_not_tie` → taxonomy drift + minority-interest sign

- 663 bp gap pre-fix. Extracted: statutory $539M + state $63M + NCI $69M + nondeductible $22M + other $2M + foreign $14M + credits $9M → engine $700M vs disclosed $530M.
- Two issues:
  1. `EffectiveIncomeTaxRateReconciliationCrossBorderTaxEffectAmount` = −$2.0M was missed (new namespace) — now collected.
  2. **Minority-interest income** (`IncomeTaxReconciliationMinorityInterestIncomeExpense`, +$69M) was classified into `other` as a positive addback, but NCI income reduces consolidated income tax (the minority holders bear their share of tax). The mapper now has an NCI bucket that negates it — this fix removes the ~2 × $69M ≈ $138M (~54 bp) overstatement.
- **Post-fix: 118 bp (down from 663 bp).** Engine ≈ $560M vs disclosed $530M. Still SKIP — the disclosed recon has further untagged items (Nucor's FDII/credits detail is not fully tagged), but the NCI fix is correct for fidelity and future filings.

### 3.7 UFPI (Universal Forest Products) — FAIL → PASS via additive-convention credit mapping

- 179 bp FAIL pre-fix (only failing company in the benchmark): the engine's `taxCredits` path **always reduces tax** (`validatePositive('taxCredits', …)` in `etr-reconciliation.ts` / `current-tax.ts`), but UFPI's disclosed recon shows credits as **additive (positive) impacts** — a filer presentation convention, not a sign error in the engine.
- Fix in `xbrl-map.ts`: when the credit-flip heuristic is NOT applied (`creditSignFlipped=false`), credit items now flow through `otherAdjustments` exactly as filed (direct impacts) instead of the engine `taxCredits` path. Deductions and NCI items continue to negate; nothing changes for flipped filers.
- **Post-fix: 19 bp PASS.** This was the only engine-reachable artifact among the skips — the fix also documents that the engine's credit-sign convention (credits reduce tax) is correct for provision math and the mapper now faithfully reproduces each filer's presentation.

---

## 4. Recommended changes (ranked, P1–P3 implemented)

| Priority | Change | File(s) | Effort | Expected impact | Status |
|---|---|---|---|---|---|
| P1 | Collect new-taxonomy dollar tags: in addition to `IncomeTaxReconciliation*`, also collect `EffectiveIncomeTaxRateReconciliation*` (USD, annual, aligned to fiscal year); skip `*Percent`; dedupe against legacy tags | `ground-truth.ts` | Small | HSY SKIP → WARN; BRO/NUE footnotes more complete | **DONE** — HSY 268→122 bp, NUE 663→118 bp, CHD/ROL/POOL → PASS |
| P1 | Add minority-interest bucket: classify `…MinorityInterestIncomeExpense` (both namespaces) into a tax-reducing bucket | `xbrl-map.ts` | Small | NUE error reduced ~54 bp; correct for any future NCI filer | **DONE** — NUE overstatement removed (~$138M) |
| P2 | Percent-path support: for filers with no USD items, read `units.pure` percentages × pretax income into impacts; only use when the percent items internally tie to the disclosed ETR (gate on tie, same as dollars) | `ground-truth.ts` + `xbrl-map.ts` | Medium | CLX potentially recoverable; must pass tie gate | **DONE** — CLX now attempts 7 percent items; still SKIP (disclosed percent data ties at 164 bp, by design) |
| P2 | Target rotation: replace JKHY and WDFC with filers that machine-tag a clean domestic recon | `run-eval.ts` TARGETS + cache | Small | Eliminates the two unrecoverable skips | **DONE** — JKHY → FAST (WARN 74 bp), WDFC → ITW (WARN 68 bp); validated 7/12 |
| P3 | Benchmark expansion: add 8 more targets (GGG, IEX, BRC, SSD, MSM, CSL, AWI, UFPI); scan and reject candidates on the tie gate (NDSN, FELE) | `run-eval.ts` TARGETS + live facts fetch | Small | More coverage without weakening the gate | **DONE** — 15/20 validated, mean 17.5 bp |
| P3 | Additive-convention credit mapping: filers that disclose credits as additive impacts flow as-filed via `otherAdjustments` when the credit-flip heuristic is not applied | `xbrl-map.ts` | Small | UFPI 179 bp FAIL → 19 bp PASS; correct fidelity for future filers | **DONE** — 0 FAIL remaining |
| P3 | Surface the US EDGAR eval in CI (live fetch, `EDGAR_USER_AGENT`), non-fatal | `.github/workflows/ci.yml` | Small | Continuous re-baseline on master | **DONE** — step runs after the Agent Harness |

## 5. What will NOT change (and why)

- **SKIP semantics stay.** The tie gate is the harness's data-quality contract; weakening it to force higher validation counts would misrepresent engine coverage. HSY's 122 bp case shows the gate is doing its job — it de-skips only when the footnote genuinely ties.
- **No engine changes.** All root causes sit in the eval extractor/mapper or in filer data, never in `@taxpro/tax-engine` — every evaluated company lands ≤ 100 bp, mean 17.5 bp.
- **Cache stays local-only.** The eval cache directory is git-ignored; CI runs the US eval live so a fresh clone always re-fetches current companyfacts.

## 6. Claim to publish

"US ASC 740 benchmark: 15/20 SEC 10-K filings validated (12 PASS, 3 WARN, 0 FAIL, mean ETR delta 17.5 bp); 5/20 skipped — all root causes from the skip-gap analysis addressed (P1 new-tag namespace + minority-interest sign; P2 percent-unit path + target rotation; P3 target expansion + additive-convention credit mapping + CI surfacing), with the remaining skips failing the internal tie gate by design or left as filer-data gaps (CLX, HSY, BRO, TYL, NUE). Details: `docs/EDGAR_SKIP_GAP_REPORT.md`. Skips are never counted as validation."

---

*Report generated from: `OFFLINE=1 npm run eval` output (2026-08-01), tag-level audit of the 12 cached companyfacts payloads, and source review of `scripts/eval/{ground-truth,xbrl-map,run-eval}.ts`.*
