import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { tenants } from './schema/tenants.js';
import { users } from './schema/users.js';
import { entities } from './schema/entities.js';
import { accounts } from './schema/accounts.js';
import { taxMappings } from './schema/tax-mappings.js';
import { trialBalance } from './schema/trial-balance.js';

const DEMO_PERIOD = '2026-01-01';
const DEMO_PERIOD_END = '2026-12-31';

const demoAccounts = [
  {
    externalId: '4000',
    accountNumber: '4000',
    name: 'Subscription revenue',
    type: 'Income',
    detailType: 'Income',
    balance: '-4800000',
    mapping: { taxAccountType: 'NODIFF_REVENUE', bookTreatment: 'no_diff' },
  },
  {
    externalId: '5000',
    accountNumber: '5000',
    name: 'Salaries and wages',
    type: 'Expense',
    detailType: 'Expense',
    balance: '1600000',
    mapping: { taxAccountType: 'NODIFF_SALARIES', bookTreatment: 'no_diff' },
  },
  {
    externalId: '5100',
    accountNumber: '5100',
    name: 'Office rent',
    type: 'Expense',
    detailType: 'Expense',
    balance: '240000',
    mapping: { taxAccountType: 'NODIFF_RENT', bookTreatment: 'no_diff' },
  },
  {
    externalId: '5200',
    accountNumber: '5200',
    name: 'Book depreciation expense',
    type: 'Expense',
    detailType: 'Fixed Asset',
    balance: '520000',
    mapping: { taxAccountType: 'TEMP_DEPRECIATION', bookTreatment: 'temporary', timingCategory: 'taxable_temporary' },
  },
  {
    externalId: '5300',
    accountNumber: '5300',
    name: 'Bad debt reserve',
    type: 'Expense',
    detailType: 'Expense',
    balance: '120000',
    mapping: { taxAccountType: 'TEMP_BAD_DEBT_RESERVE', bookTreatment: 'temporary', timingCategory: 'deductible_temporary' },
  },
  {
    externalId: '5400',
    accountNumber: '5400',
    name: 'Research and development',
    type: 'Expense',
    detailType: 'Expense',
    balance: '650000',
    mapping: { taxAccountType: 'TEMP_RESEARCH_CREDIT', bookTreatment: 'temporary', timingCategory: 'deductible_temporary' },
  },
  {
    externalId: '5500',
    accountNumber: '5500',
    name: 'Meals and entertainment',
    type: 'Expense',
    detailType: 'Expense',
    balance: '85000',
    mapping: { taxAccountType: 'PERM_MEALS_ENTERTAINMENT', bookTreatment: 'permanent' },
  },
  {
    externalId: '5600',
    accountNumber: '5600',
    name: 'Penalties and fines',
    type: 'Expense',
    detailType: 'Expense',
    balance: '25000',
    mapping: { taxAccountType: 'PERM_PENALTIES_FINES', bookTreatment: 'permanent' },
  },
  // Low-confidence AI mapping to trigger review item
  {
    externalId: '5700',
    accountNumber: '5700',
    name: 'Software subscription costs',
    type: 'Expense',
    detailType: 'Expense',
    balance: '95000',
    mapping: { taxAccountType: 'TEMP_DEFERRED_REVENUE', bookTreatment: 'temporary', timingCategory: 'deductible_temporary' },
  },
  // Unmapped account (no mapping entry created below) to trigger missing_mapping review
  {
    externalId: '5800',
    accountNumber: '5800',
    name: 'Cloud infrastructure hosting',
    type: 'Expense',
    detailType: 'Expense',
    balance: '180000',
    mapping: null, // no mapping created
  },
] as const;

async function main() {
  const [tenant] = await db.insert(tenants).values({
    name: 'Acme Demo Corp',
    slug: 'acme-demo',
    taxRate: '0.21',
    stateTaxRate: '0.05',
    fiscalYearEnd: '2026-12-31',
  }).onConflictDoUpdate({
    target: tenants.slug,
    set: {
      name: 'Acme Demo Corp',
      taxRate: '0.21',
      stateTaxRate: '0.05',
      updatedAt: new Date(),
    },
  }).returning();

  const passwordHash = await bcrypt.hash('TaxProDemo123!', 12);
  await db.insert(users).values({
    tenantId: tenant.id,
    email: 'demo@taxpro.ai',
    passwordHash,
    role: 'admin',
  }).onConflictDoUpdate({
    target: users.email,
    set: { tenantId: tenant.id, passwordHash, role: 'admin' },
  });

  // Partner (same tenant) for the two-person sign-off workflow: a partner must
  // never be the person who submitted the run.
  await db.insert(users).values({
    tenantId: tenant.id,
    email: 'partner@taxpro.ai',
    passwordHash,
    role: 'admin',
  }).onConflictDoUpdate({
    target: users.email,
    set: { tenantId: tenant.id, passwordHash, role: 'admin' },
  });

  const [entity] = await db.insert(entities).values({
    tenantId: tenant.id,
    externalId: 'ACME-US',
    name: 'Acme US Inc.',
    type: 'domestic',
    currency: 'USD',
    isConsolidated: true,
    taxJurisdiction: 'US-Federal',
  }).onConflictDoUpdate({
    target: [entities.tenantId, entities.externalId],
    set: { name: 'Acme US Inc.', updatedAt: new Date() },
  }).returning();

  let accountCount = 0;
  for (const demoAccount of demoAccounts) {
    const [account] = await db.insert(accounts).values({
      tenantId: tenant.id,
      externalId: demoAccount.externalId,
      accountNumber: demoAccount.accountNumber,
      name: demoAccount.name,
      type: demoAccount.type,
      detailType: demoAccount.detailType,
      isSummary: false,
    }).onConflictDoUpdate({
      target: [accounts.tenantId, accounts.externalId],
      set: {
        accountNumber: demoAccount.accountNumber,
        name: demoAccount.name,
        type: demoAccount.type,
        detailType: demoAccount.detailType,
        updatedAt: new Date(),
      },
    }).returning();

    // Skip mapping for unmapped demo account (triggers missing_mapping review item)
    if (demoAccount.mapping === null) {
      await db.insert(trialBalance).values({
        tenantId: tenant.id,
        entityId: entity.id,
        accountId: account.id,
        period: DEMO_PERIOD,
        periodEnd: DEMO_PERIOD_END,
        fiscalYear: 2026,
        fiscalPeriod: 0,
        debit: Number(demoAccount.balance) > 0 ? demoAccount.balance : '0',
        credit: Number(demoAccount.balance) < 0 ? String(Math.abs(Number(demoAccount.balance))) : '0',
        balance: demoAccount.balance,
        source: 'demo',
      }).onConflictDoUpdate({
        target: [trialBalance.tenantId, trialBalance.entityId, trialBalance.accountId, trialBalance.period, trialBalance.source],
        set: { balance: demoAccount.balance },
      });
      accountCount++;
      continue;
    }

    // Low confidence for software subscription (triggers low_confidence_mapping review item)
    const confidenceScore = demoAccount.externalId === '5700' ? '0.65' : '0.95';

    await db.insert(taxMappings).values({
      tenantId: tenant.id,
      accountId: account.id,
      taxAccountType: demoAccount.mapping.taxAccountType,
      bookTreatment: demoAccount.mapping.bookTreatment,
      timingCategory: 'timingCategory' in demoAccount.mapping ? demoAccount.mapping.timingCategory : undefined,
      confidenceScore,
      suggestedByAi: true,
      aiExplanation: `Demo mapping for ${demoAccount.name}`,
      version: 1,
      isActive: true,
    }).onConflictDoUpdate({
      target: [taxMappings.tenantId, taxMappings.accountId, taxMappings.version],
      set: {
        taxAccountType: demoAccount.mapping.taxAccountType,
        bookTreatment: demoAccount.mapping.bookTreatment,
        timingCategory: 'timingCategory' in demoAccount.mapping ? demoAccount.mapping.timingCategory : undefined,
        confidenceScore: '0.95',
        suggestedByAi: true,
        aiExplanation: `Demo mapping for ${demoAccount.name}`,
        isActive: true,
        updatedAt: new Date(),
      },
    });

    await db.insert(trialBalance).values({
      tenantId: tenant.id,
      entityId: entity.id,
      accountId: account.id,
      period: DEMO_PERIOD,
      periodEnd: DEMO_PERIOD_END,
      fiscalYear: 2026,
      fiscalPeriod: 0,
      debit: Number(demoAccount.balance) > 0 ? demoAccount.balance : '0',
      credit: Number(demoAccount.balance) < 0 ? String(Math.abs(Number(demoAccount.balance))) : '0',
      balance: demoAccount.balance,
      source: 'demo',
    }).onConflictDoUpdate({
      target: [trialBalance.tenantId, trialBalance.entityId, trialBalance.accountId, trialBalance.period, trialBalance.source],
      set: {
        debit: Number(demoAccount.balance) > 0 ? demoAccount.balance : '0',
        credit: Number(demoAccount.balance) < 0 ? String(Math.abs(Number(demoAccount.balance))) : '0',
        balance: demoAccount.balance,
      },
    });

    accountCount++;
  }

  console.log(`[Seed] Demo tenant ready: demo@taxpro.ai / TaxProDemo123! (partner: partner@taxpro.ai)`);
  console.log(`[Seed] Created ${accountCount} accounts and trial-balance rows for ${DEMO_PERIOD}.`);
}

main().catch((err) => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
