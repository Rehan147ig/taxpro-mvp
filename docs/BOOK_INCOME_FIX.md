# Book Income Fix — Sign Convention & Integration Test

## Bug: computeBookIncome double-counted expenses

**Before** — summed all filtered balances regardless of sign:
```ts
state.parsedItems
  .filter(p => p.accountType === 'Income' || p.accountType === 'Expense')
  .reduce((s, i) => s.plus(new Decimal(i.balance)), new Decimal(0));
```
With `Income=1000000`, `Expense=400000`, `Expense=100000`, `Expense=20000`:
→ `1000000 + 400000 + 100000 + 20000 = 1,520,000` (wrong — double-counts expenses)

**After** — uses abs() per account type, always Income - Expense:
```ts
let income = 0, expense = 0;
for (const p of state.parsedItems) {
  if (p.accountType === 'Income') income += |balance|;
  if (p.accountType === 'Expense') expense += |balance|;
}
return income - expense;  // PBT = ΣIncome - ΣExpense
```
→ `1000000 - 400000 - 100000 - 20000 = 480,000` (correct PBT)

## Sign convention enforced in parser-agent.ts

1. **LLM prompt**: explicit CRITICAL SIGN CONVENTION — Income positive, Expense negative
2. **Post-process normalization**: Zod output is scanned; any positive Expense balance is negated, any negative Income balance is negated

## Integration test (provision-integration.test.ts)

3 test cases added to `packages/tax-engine/src/__tests__/`:
1. `bookIncome = Income - Expense = 480000, not 1.52M` — proves sign convention
2. `computeBookTaxDifferences produces non-zero temporary + permanent differences` — proves deferred tax calculation with MACRS
3. `full pipeline: book income → current tax → deferred tax → ETR` — end-to-end proof

## assetAgeYears limitation

`computeBookTaxDifferences` defaults `assetAgeYears=1` for all assets (first-year MACRS). A one-time warning is logged on first temporary difference encounter. Future work: parse placed-in-service date from trial balance.

## Test results

```bash
npm test --workspace=packages/tax-engine
# 95 passed (92 + 3 new integration tests)

npm test --workspace=apps/api
# 90 passed (83 + 7 calculate-stage tests)
```
