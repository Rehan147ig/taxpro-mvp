/**
 * Automated provision test runner.
 *
 * Runs a full provision for each period and entity combination,
 * saves results, and prints a summary table.
 *
 * Usage: npx tsx scripts/run-provision-tests.ts
 */

import { db } from '../src/config/db.js';
import { tenants } from '../src/db/schema/tenants.js';
import { entities as entitiesSchema } from '../src/db/schema/entities.js';
import { trialBalance } from '../src/db/schema/trial-balance.js';
import { taxMappings } from '../src/db/schema/tax-mappings.js';
import { accounts } from '../src/db/schema/accounts.js';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { runProvisionMath } from '../src/modules/provision/provision-calculator.js';

const INCOME_TYPES = new Set(['Income', 'Revenue', 'OtherIncome', 'Sales', 'ServiceRevenue']);
const EXPENSE_TYPES = new Set(['Expense', 'COGS', 'OtherExpense', 'OperatingExpense', 'SG&A', 'CostOfSales']);

interface TestResult {
  label: string;
  period: string;
  entityId?: string;
  entityName: string;
  bookIncome: number;
  totalTaxExpense: number;
  effectiveTaxRate: number;
  statutoryRate: number;
  currentTax: number;
  deferredTax: number;
  taxPayable: number;
  totalRevenue: number;
  totalExpenses: number;
  permanentDifferences: number;
  temporaryDifferences: number;
  journalEntries: number;
  status: 'passed' | 'failed';
  error?: string;
}

async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'acme-synthetic')).limit(1);
  if (!tenant) {
    console.error('Synthetic tenant not found. Run npm run db:synthetic first.');
    process.exit(1);
  }

  const allEntities = await db.select().from(entitiesSchema)
    .where(eq(entitiesSchema.tenantId, tenant.id));
  const allAccounts = await db.select().from(accounts)
    .where(eq(accounts.tenantId, tenant.id));
  const accountMap = new Map(allAccounts.map(a => [a.id, a]));
  const allMappings = await db.select().from(taxMappings)
    .where(and(eq(taxMappings.tenantId, tenant.id), eq(taxMappings.isActive, true)));
  const mappingMap = new Map(allMappings.map(m => [m.accountId, m]));

  const periods = [
    { period: '2026-01-01', end: '2026-03-31', label: 'Q1 2026' },
    { period: '2026-04-01', end: '2026-06-30', label: 'Q2 2026' },
    { period: '2026-07-01', end: '2026-09-30', label: 'Q3 2026' },
    { period: '2026-10-01', end: '2026-12-31', label: 'Q4 2026 (FY)' },
  ];

  const federalRate = Number(tenant.taxRate);
  const stateRate = Number(tenant.stateTaxRate ?? 0);
  const results: TestResult[] = [];

  console.log('\n🧪 TaxPro Automated Provision Test Suite\n');
  console.log(`Tenant: ${tenant.name}`);
  console.log(`Entities: ${allEntities.map(e => e.name).join(', ')}`);
  console.log(`Accounts: ${allAccounts.length} (${allMappings.length} mapped, ${allAccounts.length - allMappings.length} unmapped)`);
  console.log(`Rate: Federal ${(federalRate * 100).toFixed(1)}%, State ${(stateRate * 100).toFixed(1)}%\n`);

  for (const period of periods) {
    // Consolidated run
    const conResult = await runSingleTest(tenant.id, period, undefined, 'Consolidated', federalRate, stateRate, mappingMap, accountMap);
    results.push(conResult);

    // Per-entity runs
    for (const entity of allEntities) {
      const entResult = await runSingleTest(tenant.id, period, entity.id, entity.name, federalRate, stateRate, mappingMap, accountMap);
      results.push(entResult);
    }
  }

  // Print results table
  console.log('Results Summary');
  console.log('='.repeat(120));
  console.log(
    'Period         Entity            Book Income    Tax Expense    ETR      Current Tax   Deferred Tax  Payable     Status'
  );
  console.log('-'.repeat(120));

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const etrStr = r.bookIncome !== 0 ? `${(r.effectiveTaxRate * 100).toFixed(2)}%` : 'N/A';
    console.log(
      `${r.label.padEnd(15)} ${r.entityName.padEnd(17)} ${
        String(r.bookIncome.toLocaleString()).padStart(12)} ${
        String(Math.round(r.totalTaxExpense).toLocaleString()).padStart(12)} ${
        etrStr.padStart(8)} ${
        String(Math.round(r.currentTax).toLocaleString()).padStart(12)} ${
        String(Math.round(r.deferredTax).toLocaleString()).padStart(12)} ${
        String(Math.round(r.taxPayable).toLocaleString()).padStart(10)} ${
        r.status === 'passed' ? '✅' : '❌'}`
    );
    if (r.status === 'passed') passed++;
    else failed++;
  }

  console.log('-'.repeat(120));
  console.log(`\n📊 Summary: ${passed} passed, ${failed} failed, ${results.length} total\n`);

  // Print ETR reconciliation for each period
  console.log('\nETR Reconciliation (Consolidated)');
  console.log('='.repeat(80));

  for (const period of periods) {
    const conResult = results.find(r => r.label === period.label && r.entityName === 'Consolidated');
    if (!conResult) continue;

    console.log(`\n${period.label}:`);
    console.log(`  Book Income:     ${conResult.bookIncome.toLocaleString()}`);
    console.log(`  Revenue:         ${conResult.totalRevenue.toLocaleString()}`);
    console.log(`  Expenses:        ${conResult.totalExpenses.toLocaleString()}`);
    console.log(`  Perm Diffs:      ${conResult.permanentDifferences.toLocaleString()}`);
    console.log(`  Temp Diffs:      ${conResult.temporaryDifferences.toLocaleString()}`);
    console.log(`  Current Tax:     ${Math.round(conResult.currentTax).toLocaleString()}`);
    console.log(`  Deferred Tax:    ${Math.round(conResult.deferredTax).toLocaleString()}`);
    console.log(`  Total Tax:       ${Math.round(conResult.totalTaxExpense).toLocaleString()}`);
    console.log(`  ETR:             ${(conResult.effectiveTaxRate * 100).toFixed(2)}%`);
    console.log(`  Tax Payable:     ${Math.round(conResult.taxPayable).toLocaleString()}`);

    if (conResult.bookIncome > 0) {
      const etrVsStatutory = ((conResult.effectiveTaxRate - federalRate) * 100).toFixed(2);
      console.log(`  ETR vs Stat:     ${etrVsStatutory}%`);
    }
  }
}

async function runSingleTest(
  tenantId: string,
  period: { period: string; end: string; label: string },
  entityId: string | undefined,
  entityName: string,
  federalRate: number,
  stateRate: number,
  mappingMap: Map<string, any>,
  accountMap: Map<string, any>,
): Promise<TestResult> {
  try {
    const tbData = await db.select().from(trialBalance)
      .where(and(
        eq(trialBalance.tenantId, tenantId),
        gte(trialBalance.period, period.period),
        lte(trialBalance.period, period.end),
        ...(entityId ? [eq(trialBalance.entityId, entityId)] : []),
      ));

    if (tbData.length === 0) {
      return {
        label: period.label,
        period: period.period,
        entityId,
        entityName,
        bookIncome: 0,
        totalTaxExpense: 0,
        effectiveTaxRate: 0,
        statutoryRate: federalRate,
        currentTax: 0,
        deferredTax: 0,
        taxPayable: 0,
        totalRevenue: 0,
        totalExpenses: 0,
        permanentDifferences: 0,
        temporaryDifferences: 0,
        journalEntries: 0,
        status: 'failed',
        error: 'No trial balance data',
      };
    }

    // Group by account
    const tbByAccount = new Map<string, number>();
    for (const tb of tbData) {
      tbByAccount.set(tb.accountId, (tbByAccount.get(tb.accountId) ?? 0) + Number(tb.balance ?? 0));
    }

    const accountIds = [...tbByAccount.keys()];
    const provisionAccounts = accountIds.length > 0
      ? await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, accountIds)))
      : [];
    const localAccountMap = new Map(provisionAccounts.map(a => [a.id, a]));

    let totalRevenue = 0;
    let totalExpenses = 0;
    const permanentDifferences: { amount: number; label: string }[] = [];
    const temporaryDifferences: {
      accountId: string; entityId: string; period: string;
      bookBalance: number; taxBalance: number; difference: number;
      diffType: 'temporary'; timingCategory?: string;
    }[] = [];

    for (const [accountId, balance] of tbByAccount) {
      const m = mappingMap.get(accountId);
      if (!m) continue;
      const acct = localAccountMap.get(accountId) ?? accountMap.get(accountId);
      if (acct?.type && INCOME_TYPES.has(acct.type)) totalRevenue += Math.abs(balance);
      if (acct?.type && EXPENSE_TYPES.has(acct.type)) totalExpenses += Math.abs(balance);

      if (m.bookTreatment === 'permanent') {
        permanentDifferences.push({ amount: balance, label: m.taxAccountType });
      } else if (m.bookTreatment === 'temporary') {
        temporaryDifferences.push({
          accountId, entityId: entityId ?? 'consolidated', period: period.period,
          bookBalance: balance, taxBalance: 0, difference: balance,
          diffType: 'temporary', timingCategory: m.timingCategory ?? undefined,
        });
      }
    }

    const bookIncome = totalRevenue - totalExpenses;
    const mathResult = runProvisionMath({
      bookIncome,
      permanentDifferences,
      temporaryDifferences,
      federalRate,
      stateRate: stateRate > 0 ? stateRate : undefined,
      entityId: entityId ?? 'consolidated',
      period: period.period,
    });

    return {
      label: period.label,
      period: period.period,
      entityId,
      entityName,
      bookIncome: mathResult.summary.bookIncome,
      totalTaxExpense: mathResult.summary.totalTaxExpense,
      effectiveTaxRate: mathResult.summary.effectiveTaxRate,
      statutoryRate: federalRate,
      currentTax: mathResult.summary.currentTaxExpense,
      deferredTax: mathResult.summary.deferredTaxExpense,
      taxPayable: mathResult.summary.taxPayable,
      totalRevenue,
      totalExpenses,
      permanentDifferences: permanentDifferences.reduce((s, d) => s + (d.amount ?? 0), 0),
      temporaryDifferences: temporaryDifferences.reduce((s, d) => s + (d.difference ?? d.bookBalance ?? 0), 0),
      journalEntries: mathResult.journalEntries.length,
      status: 'passed',
    };
  } catch (err) {
    return {
      label: period.label,
      period: period.period,
      entityId, entityName,
      bookIncome: 0, totalTaxExpense: 0, effectiveTaxRate: 0, statutoryRate: federalRate,
      currentTax: 0, deferredTax: 0, taxPayable: 0,
      totalRevenue: 0, totalExpenses: 0, permanentDifferences: 0, temporaryDifferences: 0, journalEntries: 0,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
