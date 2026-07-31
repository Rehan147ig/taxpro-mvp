# AI Mapping Evaluation Harness

## Overview

The AI mapping eval tests the mapping agent's accuracy against a curated golden dataset of 200 account names with known tax treatments.

## Golden Dataset

**Location:** `packages/tax-engine/eval/golden-mapping.json`

200 entries spanning:
- **Permanent differences (12):** Meals, fines, life insurance, tax-exempt interest, DRD, goodwill impairment, lobbying, political contributions, parking, holiday gifts, charitable contributions, litigation settlements
- **Temporary differences (60):** Depreciation (buildings, equipment, vehicles, leasehold improvements), bonus depreciation, Section 179, amortization, R&D capitalization, bad debt, warranty, deferred revenue, accrued liabilities (bonuses, restructuring, environmental, pension, self-insurance, ARO), NOL, stock compensation, interest capitalization, deferred rent, website dev, trademarks, non-compete, customer lists, patent filing, shelf registration, hedge ineffectiveness, unrealized gains
- **No difference (128):** Revenue, salaries, rent, utilities, COGS, insurance, marketing, travel, legal fees, bank charges, and many more ordinary business expenses

## Running

```bash
npm run eval:ai-mapping -w @taxpro/api
```

## Expected Output

```
📊 AI Mapping Eval — 200 golden entries

Calling mapping agent...

📈 Results:
  Treatment accuracy: 172/200 (86.0%)
  Tax type accuracy:   168/200 (84.0%)
  Fully correct:       164/200 (82.0%)

❌ 36 incorrect classifications:
  "Parking Expense - Employees" — predicted: no_diff, expected: permanent/PERM_OTHER

⚠ 12 low-confidence predictions (<75%)

✅ PASS: Accuracy ≥ 80%
```

## Threshold
- **PASS:** ≥ 80% fully correct
- **FAIL:** < 80% → exit code 1

## Dry-Run Mode
If no AI provider is configured, the eval runs in dry-run mode — counts distribution by expected treatment and exits with:
```
✅ Dry-run complete — 0/0 evaluated (no AI provider)
```
