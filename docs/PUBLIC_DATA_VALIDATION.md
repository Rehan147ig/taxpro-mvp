# TaxPro — Public Data Validation

Honest evidence of how the tax engine performs against real audited filings.
This file is the source of truth for any claim about validated accuracy.
**Skipped companies are never marketed as validated.**

## Result taxonomy

Every evaluated company falls into exactly one category:

| Category | Verdict | Meaning |
|---|---|---|
| `evaluated/pass` | PASS | Footnote ties internally; engine ETR within 25bp of disclosed ETR |
| `evaluated/warn` | WARN | Footnote ties internally; engine ETR within 100bp of disclosed ETR |
| `evaluated/fail` | FAIL | Footnote ties internally; engine ETR differs by more than 100bp |
| `skipped/data_unavailable` | SKIP | Filing has no itemized recon tags (percentage-only or untagged), or fetch failed |
| `skipped/footnote_does_not_tie` | SKIP | Recon items do not reconcile to the disclosed total — data quality issue, not an engine test |

Only `evaluated/*` results count toward accuracy claims. `skipped/*` results
mean the filing could not test the engine and prove nothing.

## How to run

```bash
# US (SEC EDGAR, 12 public companies) — OFFLINE=1 uses the cached filings
OFFLINE=1 npm run eval -w @taxpro/api

# UK (Companies House fixtures, 9 filed accounts sets)
npm run eval:uk -w @taxpro/api

# AI mapping eval (dry-run / mocked / real — threshold only in real mode)
npm run eval:ai-mapping -w @taxpro/api

# US state tax rule engine vs dated Tax Foundation 2026 snapshots
npm run verify:us-rates -w @taxpro/tax-engine-enterprise
```

## US — SEC EDGAR (20 target companies)

Targets are simple, primarily-domestic, consistently profitable companies whose
tax footnotes are short and clean. Status (last full run, cached filings):

- 12 evaluated/pass, 3 evaluated/warn, 0 evaluated/fail, 5 skipped
- Mean ETR delta: 17.5bp across 15 evaluated companies (validated 15/20)
- Skip reasons observed: no itemized recon tags (percentage-only or untagged
  filings — CLX), footnote does not tie internally (HSY, BRO, TYL, NUE)
- Skip-gap fixes landed 2026-08-01 (P1 + P2) and 2026-08-03 (P3):
  new-taxonomy tag collection, minority-interest bucket, percent-unit path,
  target rotation (JKHY → FAST, WDFC → ITW), target expansion to 20
  (GGG/IEX/BRC/SSD/MSM/CSL/AWI/UFPI; NDSN/FELE rejected on the tie gate),
  additive-convention credit mapping (UFPI 179 bp FAIL → 19 bp PASS), and a
  live US eval step in CI. HSY's residual ≈$14.8M gap is untagged XBRL lines
  — not recoverable by code. See `docs/EDGAR_SKIP_GAP_REPORT.md` for the full
  breakdown.

Engine inputs are the disclosed recon items; the engine re-derives the ETR.
Credits use a per-filing sign convention chosen so the footnote ties to the
disclosed total (filer convention quirk), reported as `[credits sign-flipped]`
when it applies; additive-convention filers now flow through `otherAdjustments`
as-filed.

Classified recon buckets: permanent differences, tax credits, deductions
(FDII/QPAI), minority interest, state & local income taxes, foreign rate
differential, valuation allowance, share-based compensation, contingencies,
prior-year adjustments, other.

## UK — Companies House (9 fixture sets)

Fixtures are transcribed from filed statutory accounts (OCR + vision
transcription of scanned PDFs). Every fixture records:

- company name + Companies House number + accounting period end
- source document URL (filing history page)
- accounting standard (FRS 102 / FRS 101 / IFRS)
- note refs and any manual adjustments

Status (last full run): 9/9 PASS, mean ETR delta 1.3bp, deferred tax 0bp.

## AI mapping eval

`run-ai-mapping-eval.ts` modes:

- `dry-run` — no provider configured: prints golden-set distribution, exits 0.
  No accuracy claim.
- `mocked` (`AI_EVAL_MODE=mocked` or `MOCK_AI=1`) — scripted golden answers
  against the real harness plumbing; 202/202. No accuracy claim.
- `real` (`AI_EVAL_MODE=real` with a configured provider) — real model calls;
  the ≥80% threshold is enforced **only in this mode**. PASS above threshold,
  exit 1 below.

Any material quoting accuracy must use real-mode numbers only.

## US state tax rule engine — live-source snapshot validation (2026-08-03)

The 51-jurisdiction state tax rule engine (`packages/tax-engine-enterprise/src/us/`)
is validated against **dated** snapshots from public sources, so a re-run at any
later date proves *what the law was on the capture date* and flags what has
churned since (`npm run verify:us-rates -w @taxpro/tax-engine-enterprise`):

- Rates: 51/51 jurisdictions exact vs `TF_2026_RATES` (Tax Foundation 2026,
  published 2026-01-05, updated 2026-04-02, captured 2026-04-02). The initial
  snapshot had 25/51 stale rates; all corrected and locked by the verifier.
- Apportionment weights: 51/51 exact vs `TF_2026_APPORTIONMENT` (Tax Foundation
  TaxEDU "State Primary Apportionment Factors for Tax Year 2026", captured
  2026-08-03). 8/51 rows were wrong initially (DE/MT wrongly three-factor;
  KS/ND/NM/OK are actually three-factor; FL/VA double-weighted sales) — all
  corrected.

**What snapshot equality does not certify:** the top-tier-only bracketed
schedules, CT's 10% surtax, NJ's entire-net-income regime, and KS/OK
single-sales-factor effective dates remain flagged for CPA sign-off; the
rule-refresh loop's human-approval step is the gate (see
`docs/STATE_RULE_REFRESH.md`).

## Validation vs filing-ready

These evals validate engine math against audited filings. They are not a
filing-ready certification: no HMRC/Companies House validator is integrated,
and compliance exports (CT600/iXBRL/MTD) remain structure generators.
