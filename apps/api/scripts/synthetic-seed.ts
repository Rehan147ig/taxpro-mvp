/**
 * Synthetic corporate data generator for TaxPro pilot testing.
 *
 * Generates a realistic mid-market SaaS company with:
 * - 2 legal entities (US Parent + DE Subsidiary)
 * - 40+ accounts covering full chart of accounts
 * - 4 quarterly periods (Q1-Q4 2026)
 * - Proper debits/credits with realistic balances
 * - Full tax mappings with a mix of permanent, temporary, no-diff
 * - Some unmapped/low-confidence accounts for review queue
 * - Year-over-year growth pattern for rollforward testing
 *
 * Run: npx tsx src/db/synthetic-seed.ts
 */

import bcrypt from 'bcryptjs';
import { db } from '../src/config/db.js';
import { tenants } from '../src/db/schema/tenants.js';
import { users } from '../src/db/schema/users.js';
import { entities } from '../src/db/schema/entities.js';
import { accounts } from '../src/db/schema/accounts.js';
import { taxMappings } from '../src/db/schema/tax-mappings.js';
import { trialBalance } from '../src/db/schema/trial-balance.js';

// ── Configuration ──

interface AccountDef {
  number: string;
  name: string;
  type: 'Income' | 'Expense' | 'Asset' | 'Liability' | 'Equity';
  detailType: string;
  isSummary: boolean;
  mapping: {
    type: string;
    treatment: 'permanent' | 'temporary' | 'no_diff';
    timing?: string;
    confidence?: string;
  } | null; // null = unmapped (triggers review)
}

interface EntityDef {
  id: string;
  name: string;
  jurisdiction: string;
  taxRate: string;
  stateRate: string;
  isConsolidated: boolean;
  revenueFactor: number; // multiplier for revenue/expense allocation
}

interface PeriodDef {
  period: string; // YYYY-MM-DD (start)
  periodEnd: string; // YYYY-MM-31
  label: string;
  growthFactor: number; // multiplier vs base (e.g. 1.0 = base, 1.05 = 5% growth)
}

const ENTITIES: EntityDef[] = [
  { id: 'ACME-US', name: 'Acme US Inc.', jurisdiction: 'US-Federal', taxRate: '0.21', stateRate: '0.05', isConsolidated: true, revenueFactor: 0.70 },
  { id: 'ACME-DE', name: 'Acme Delaware LLC', jurisdiction: 'US-Delaware', taxRate: '0.21', stateRate: '0.087', isConsolidated: true, revenueFactor: 0.30 },
];

const PERIODS: PeriodDef[] = [
  { period: '2026-01-01', periodEnd: '2026-03-31', label: 'Q1 2026', growthFactor: 1.00 },
  { period: '2026-04-01', periodEnd: '2026-06-30', label: 'Q2 2026', growthFactor: 1.08 },
  { period: '2026-07-01', periodEnd: '2026-09-30', label: 'Q3 2026', growthFactor: 1.15 },
  { period: '2026-10-01', periodEnd: '2026-12-31', label: 'Q4 2026', growthFactor: 1.25 },
];

// Full chart of accounts for a mid-market SaaS company
const ACCOUNTS: AccountDef[] = [
  // ── Balance Sheet: Assets (1000-1999) ──
  { number: '1010', name: 'Cash and cash equivalents', type: 'Asset', detailType: 'Bank', isSummary: false, mapping: { type: 'NODIFF_CASH', treatment: 'no_diff' } },
  { number: '1020', name: 'Accounts receivable', type: 'Asset', detailType: 'AccountsReceivable', isSummary: false, mapping: { type: 'NODIFF_AR', treatment: 'no_diff' } },
  { number: '1030', name: 'Allowance for doubtful accounts', type: 'Asset', detailType: 'AccountsReceivable', isSummary: false, mapping: { type: 'TEMP_BAD_DEBT_RESERVE', treatment: 'temporary', timing: 'deductible_temporary' } },
  { number: '1040', name: 'Prepaid expenses', type: 'Asset', detailType: 'OtherCurrentAsset', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },
  { number: '1100', name: 'Property, plant & equipment (gross)', type: 'Asset', detailType: 'FixedAsset', isSummary: false, mapping: null },
  { number: '1110', name: 'Accumulated depreciation — book', type: 'Asset', detailType: 'FixedAsset', isSummary: false, mapping: { type: 'TEMP_DEPRECIATION', treatment: 'temporary', timing: 'taxable_temporary' } },
  { number: '1120', name: 'Capitalized software development costs', type: 'Asset', detailType: 'OtherAsset', isSummary: false, mapping: { type: 'TEMP_AMORTIZATION', treatment: 'temporary', timing: 'taxable_temporary' } },
  { number: '1200', name: 'Goodwill', type: 'Asset', detailType: 'OtherAsset', isSummary: false, mapping: { type: 'PERM_NONDEDUCTIBLE_GOODWILL', treatment: 'permanent' } },
  { number: '1300', name: 'Deferred tax asset', type: 'Asset', detailType: 'OtherAsset', isSummary: false, mapping: null },

  // ── Balance Sheet: Liabilities (2000-2999) ──
  { number: '2010', name: 'Accounts payable', type: 'Liability', detailType: 'AccountsPayable', isSummary: false, mapping: { type: 'NODIFF_AP', treatment: 'no_diff' } },
  { number: '2020', name: 'Accrued liabilities', type: 'Liability', detailType: 'OtherCurrentLiability', isSummary: false, mapping: { type: 'TEMP_ACCRUED_LIABILITIES', treatment: 'temporary', timing: 'deductible_temporary' } },
  { number: '2030', name: 'Deferred revenue', type: 'Liability', detailType: 'DeferredRevenue', isSummary: false, mapping: { type: 'TEMP_DEFERRED_REVENUE', treatment: 'temporary', timing: 'deductible_temporary' } },
  { number: '2040', name: 'Warranty reserve', type: 'Liability', detailType: 'OtherCurrentLiability', isSummary: false, mapping: { type: 'TEMP_WARRANTY_RESERVE', treatment: 'temporary', timing: 'deductible_temporary' } },
  { number: '2100', name: 'Deferred tax liability', type: 'Liability', detailType: 'OtherLiability', isSummary: false, mapping: null },
  { number: '2200', name: 'Long-term debt', type: 'Liability', detailType: 'LongTermDebt', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },

  // ── Balance Sheet: Equity (3000-3999) ──
  { number: '3010', name: 'Common stock', type: 'Equity', detailType: 'Equity', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },
  { number: '3020', name: 'Retained earnings', type: 'Equity', detailType: 'Equity', isSummary: true, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },
  { number: '3030', name: 'Accumulated other comprehensive income', type: 'Equity', detailType: 'Equity', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },

  // ── P&L: Revenue (4000-4999) ──
  { number: '4010', name: 'Subscription revenue — SaaS', type: 'Income', detailType: 'Income', isSummary: false, mapping: { type: 'NODIFF_REVENUE', treatment: 'no_diff' } },
  { number: '4020', name: 'Professional services revenue', type: 'Income', detailType: 'Income', isSummary: false, mapping: { type: 'NODIFF_REVENUE', treatment: 'no_diff' } },
  { number: '4030', name: 'Tax-exempt municipal bond interest', type: 'Income', detailType: 'Income', isSummary: false, mapping: { type: 'PERM_TAX_EXEMPT_INTEREST', treatment: 'permanent' } },

  // ── P&L: COGS (5000-5999) ──
  { number: '5010', name: 'Cloud infrastructure hosting', type: 'Expense', detailType: 'COGS', isSummary: false, mapping: null },
  { number: '5020', name: 'Salaries — engineering', type: 'Expense', detailType: 'COGS', isSummary: false, mapping: { type: 'NODIFF_SALARIES', treatment: 'no_diff' } },
  { number: '5030', name: 'Software license costs', type: 'Expense', detailType: 'COGS', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },

  // ── P&L: Operating Expenses (6000-6999) ──
  { number: '6010', name: 'Salaries — G&A', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'NODIFF_SALARIES', treatment: 'no_diff' } },
  { number: '6020', name: 'Salaries — sales & marketing', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'NODIFF_SALARIES', treatment: 'no_diff' } },
  { number: '6030', name: 'Office rent', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'NODIFF_RENT', treatment: 'no_diff' } },
  { number: '6040', name: 'Utilities & telecommunications', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'NODIFF_UTILITIES', treatment: 'no_diff' } },
  { number: '6050', name: 'Depreciation expense — book', type: 'Expense', detailType: 'FixedAsset', isSummary: false, mapping: { type: 'TEMP_DEPRECIATION', treatment: 'temporary', timing: 'taxable_temporary' } },
  { number: '6060', name: 'Amortization expense — software', type: 'Expense', detailType: 'FixedAsset', isSummary: false, mapping: { type: 'TEMP_AMORTIZATION', treatment: 'temporary', timing: 'taxable_temporary' } },
  { number: '6070', name: 'Research & development expense', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'TEMP_RESEARCH_CREDIT', treatment: 'temporary', timing: 'deductible_temporary' } },
  { number: '6080', name: 'Bad debt expense', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'TEMP_BAD_DEBT_RESERVE', treatment: 'temporary', timing: 'deductible_temporary' } },
  { number: '6090', name: 'Meals & entertainment', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'PERM_MEALS_ENTERTAINMENT', treatment: 'permanent' } },
  { number: '6100', name: 'Penalties & fines', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'PERM_PENALTIES_FINES', treatment: 'permanent' } },
  { number: '6110', name: 'Insurance — key person life', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'PERM_LIFE_INSURANCE', treatment: 'permanent' } },
  { number: '6120', name: 'Legal & professional fees', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },
  { number: '6130', name: 'Software subscriptions & SaaS tools', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'TEMP_DEFERRED_REVENUE', treatment: 'temporary', timing: 'deductible_temporary', confidence: '0.62' } },
  { number: '6140', name: 'Travel & entertainment', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'PERM_MEALS_ENTERTAINMENT', treatment: 'permanent' } },

  // ── P&L: Other (7000-7999) ──
  { number: '7010', name: 'Interest income', type: 'Income', detailType: 'Income', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },
  { number: '7020', name: 'Other income', type: 'Income', detailType: 'Income', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },
  { number: '7030', name: 'Interest expense', type: 'Expense', detailType: 'Expense', isSummary: false, mapping: { type: 'NODIFF_OTHER', treatment: 'no_diff' } },
  { number: '7040', name: 'Dividends received', type: 'Income', detailType: 'Income', isSummary: false, mapping: { type: 'PERM_DIVIDENDS_RECEIVED_DEDUCTION', treatment: 'permanent' } },
];

// ── Base balances (monthly, before entity/period allocation) ──
// Positive = debit balance, Negative = credit balance
const BASE_BALANCES: Record<string, { debit: number; credit: number; balance: number }> = {
  '1010': { debit: 540000, credit: 0, balance: 540000 },
  '1020': { debit: 385000, credit: 0, balance: 385000 },
  '1030': { debit: 0, credit: 28000, balance: -28000 },
  '1040': { debit: 95000, credit: 0, balance: 95000 },
  '1100': { debit: 2400000, credit: 0, balance: 2400000 },
  '1110': { debit: 0, credit: 580000, balance: -580000 },
  '1120': { debit: 720000, credit: 0, balance: 720000 },
  '1200': { debit: 350000, credit: 0, balance: 350000 },
  '1300': { debit: 45000, credit: 0, balance: 45000 },
  '2010': { debit: 0, credit: 275000, balance: -275000 },
  '2020': { debit: 0, credit: 132000, balance: -132000 },
  '2030': { debit: 0, credit: 890000, balance: -890000 },
  '2040': { debit: 0, credit: 45000, balance: -45000 },
  '2100': { debit: 0, credit: 62000, balance: -62000 },
  '2200': { debit: 0, credit: 1500000, balance: -1500000 },
  '3010': { debit: 0, credit: 100000, balance: -100000 },
  '3020': { debit: 0, credit: 2100000, balance: -2100000 },
  '3030': { debit: 0, credit: 25000, balance: -25000 },
  '4010': { debit: 0, credit: 1850000, balance: -1850000 },
  '4020': { debit: 0, credit: 420000, balance: -420000 },
  '4030': { debit: 0, credit: 8500, balance: -8500 },
  '5010': { debit: 310000, credit: 0, balance: 310000 },
  '5020': { debit: 520000, credit: 0, balance: 520000 },
  '5030': { debit: 145000, credit: 0, balance: 145000 },
  '6010': { debit: 350000, credit: 0, balance: 350000 },
  '6020': { debit: 480000, credit: 0, balance: 480000 },
  '6030': { debit: 85000, credit: 0, balance: 85000 },
  '6040': { debit: 32000, credit: 0, balance: 32000 },
  '6050': { debit: 125000, credit: 0, balance: 125000 },
  '6060': { debit: 42000, credit: 0, balance: 42000 },
  '6070': { debit: 380000, credit: 0, balance: 380000 },
  '6080': { debit: 28000, credit: 0, balance: 28000 },
  '6090': { debit: 32000, credit: 0, balance: 32000 },
  '6100': { debit: 8500, credit: 0, balance: 8500 },
  '6110': { debit: 18000, credit: 0, balance: 18000 },
  '6120': { debit: 95000, credit: 0, balance: 95000 },
  '6130': { debit: 78000, credit: 0, balance: 78000 },
  '6140': { debit: 22000, credit: 0, balance: 22000 },
  '7010': { debit: 0, credit: 12000, balance: -12000 },
  '7020': { debit: 0, credit: 4500, balance: -4500 },
  '7030': { debit: 38000, credit: 0, balance: 38000 },
  '7040': { debit: 0, credit: 15000, balance: -15000 },
};

async function main() {
  const scenario = process.argv[2] ?? 'full'; // 'full' | 'q1-only'

  const [tenant] = await db.insert(tenants).values({
    name: 'Acme Corp (Synthetic)',
    slug: 'acme-synthetic',
    taxRate: '0.21',
    stateTaxRate: '0.087',
    fiscalYearEnd: '2026-12-31',
  }).onConflictDoUpdate({
    target: tenants.slug,
    set: { name: 'Acme Corp (Synthetic)', taxRate: '0.21', stateTaxRate: '0.087', updatedAt: new Date() },
  }).returning();

  const passwordHash = await bcrypt.hash('SyntheticDemo123!', 12);
  await db.insert(users).values({
    tenantId: tenant.id,
    email: 'synthetic@taxpro.ai',
    passwordHash,
    role: 'admin',
  }).onConflictDoUpdate({
    target: users.email,
    set: { passwordHash, role: 'admin' },
  });

  // Create entities
  const createdEntities: Array<{ entity: typeof entities.$inferSelect; def: EntityDef }> = [];
  for (const ed of ENTITIES) {
    const [entity] = await db.insert(entities).values({
      tenantId: tenant.id,
      externalId: ed.id,
      name: ed.name,
      type: 'domestic',
      currency: 'USD',
      isConsolidated: ed.isConsolidated,
      taxJurisdiction: ed.jurisdiction,
    }).onConflictDoUpdate({
      target: [entities.tenantId, entities.externalId],
      set: { name: ed.name, taxJurisdiction: ed.jurisdiction, updatedAt: new Date() },
    }).returning();
    createdEntities.push({ entity, def: ed });
  }

  // Create accounts + mappings, then build TB data
  const accountMap = new Map<string, { account: typeof accounts.$inferSelect; def: AccountDef }>();

  for (const ad of ACCOUNTS) {
    const [account] = await db.insert(accounts).values({
      tenantId: tenant.id,
      externalId: ad.number,
      accountNumber: ad.number,
      name: ad.name,
      type: ad.type,
      detailType: ad.detailType,
      isSummary: ad.isSummary,
    }).onConflictDoUpdate({
      target: [accounts.tenantId, accounts.externalId],
      set: { name: ad.name, type: ad.type, detailType: ad.detailType, updatedAt: new Date() },
    }).returning();
    accountMap.set(ad.number, { account, def: ad });
  }

  // Create mappings (skip null mappings)
  let mappedCount = 0;
  let unmappedCount = 0;
  let lowConfCount = 0;

  for (const ad of ACCOUNTS) {
    const { account } = accountMap.get(ad.number)!;

    if (ad.mapping === null) {
      unmappedCount++;
      continue;
    }

    const confidence = ad.mapping.confidence ?? (ad.number === '6130' ? '0.62' : '0.92');
    if (Number(confidence) < 0.75) lowConfCount++;

    await db.insert(taxMappings).values({
      tenantId: tenant.id,
      accountId: account.id,
      taxAccountType: ad.mapping.type,
      bookTreatment: ad.mapping.treatment,
      timingCategory: ad.mapping.timing ?? null,
      confidenceScore: confidence,
      suggestedByAi: true,
      aiExplanation: `Synthetic mapping: ${ad.name} → ${ad.mapping.type} (${ad.mapping.treatment})`,
      version: 1,
      isActive: true,
    }).onConflictDoUpdate({
      target: [taxMappings.tenantId, taxMappings.accountId, taxMappings.version],
      set: { taxAccountType: ad.mapping.type, bookTreatment: ad.mapping.treatment, isActive: true, updatedAt: new Date() },
    });
    mappedCount++;
  }

  // Create trial balance for each period × entity
  const activePeriods = scenario === 'q1-only' ? PERIODS.slice(0, 1) : PERIODS;
  let tbRows = 0;

  for (const period of activePeriods) {
    for (const { entity, def } of createdEntities) {
      for (const ad of ACCOUNTS) {
        const base = BASE_BALANCES[ad.number];
        if (!base) continue;

        // Scale by entity revenue factor and period growth
        const factor = def.revenueFactor * period.growthFactor;

        // BS accounts (1000-3999) and P&L accounts (4000+) scale differently
        // BS: cumulative, P&L: period-specific
        const isBS = ['Asset', 'Liability', 'Equity'].includes(ad.type);
        const periodFactor = isBS ? 1.0 : factor;

        const balance = Math.round(base.balance * periodFactor * 100) / 100;
        const debit = balance > 0 ? Math.abs(balance) : 0;
        const credit = balance < 0 ? Math.abs(balance) : 0;

        await db.insert(trialBalance).values({
          tenantId: tenant.id,
          entityId: entity.id,
          accountId: accountMap.get(ad.number)!.account.id,
          period: period.period,
          periodEnd: period.periodEnd,
          fiscalYear: 2026,
          fiscalPeriod: activePeriods.indexOf(period) + 1,
          debit: String(debit),
          credit: String(credit),
          balance: String(balance),
          source: 'synthetic',
        }).onConflictDoUpdate({
          target: [trialBalance.tenantId, trialBalance.entityId, trialBalance.accountId, trialBalance.period, trialBalance.source],
          set: { debit: String(debit), credit: String(credit), balance: String(balance) },
        });
        tbRows++;
      }
    }
  }

  console.log(`\n✅ Synthetic data seeded successfully`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Tenant:         Acme Corp (Synthetic)`);
  console.log(`Login:          synthetic@taxpro.ai / SyntheticDemo123!`);
  console.log(`Entities:       ${createdEntities.length} (${createdEntities.map(e => e.def.id).join(', ')})`);
  console.log(`Accounts:       ${ACCOUNTS.length} (${mappedCount} mapped, ${unmappedCount} unmapped, ${lowConfCount} low-confidence)`);
  console.log(`Periods:        ${activePeriods.length} (${activePeriods.map(p => p.label).join(', ')})`);
  console.log(`TB rows:        ${tbRows}`);
  console.log(`\nMap the accounts via the UI, then run a provision at #/provision`);
  console.log(`Review queue will show ${unmappedCount + lowConfCount} items to review at #/review`);
}

main().catch((err) => {
  console.error('[Synthetic Seed] Failed:', err);
  process.exit(1);
});
