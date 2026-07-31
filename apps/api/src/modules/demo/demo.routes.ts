import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db, withTenantContext } from '../../config/db.js';
import { tenants } from '../../db/schema/tenants.js';
import { users } from '../../db/schema/users.js';
import { entities } from '../../db/schema/entities.js';
import { accounts } from '../../db/schema/accounts.js';
import { taxMappings } from '../../db/schema/tax-mappings.js';
import { trialBalance } from '../../db/schema/trial-balance.js';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { BadRequestError } from '../../lib/errors.js';

export const demoRoutes = new Hono();

const DEMO_PERIOD = '2025-01-01';
const DEMO_PERIOD_END = '2025-12-31';
const DEMO_FISCAL_YEAR = 2025;
const DEMO_FISCAL_PERIOD = 12;

const demoAccounts = [
  { externalId: '3000', number: '3000', name: 'Revenue', type: 'Income', detailType: 'Income', balance: '-1000000.00', mapping: { taxAccountType: 'NODIFF_REVENUE', bookTreatment: 'no_diff' } },
  { externalId: '4000', number: '4000', name: 'Cost of Goods Sold', type: 'Expense', detailType: 'COGS', balance: '300000.00', mapping: { taxAccountType: 'NODIFF_COGS', bookTreatment: 'no_diff' } },
  { externalId: '5000', number: '5000', name: 'Salaries and Wages', type: 'Expense', detailType: 'Expense', balance: '180000.00', mapping: { taxAccountType: 'NODIFF_SALARIES', bookTreatment: 'no_diff' } },
  { externalId: '5100', number: '5100', name: 'Office Rent', type: 'Expense', detailType: 'Expense', balance: '30000.00', mapping: { taxAccountType: 'NODIFF_RENT', bookTreatment: 'no_diff' } },
  { externalId: '5200', number: '5200', name: 'Utilities', type: 'Expense', detailType: 'Expense', balance: '10000.00', mapping: { taxAccountType: 'NODIFF_UTILITIES', bookTreatment: 'no_diff' } },
  { externalId: '6000', number: '6000', name: 'Depreciation - Buildings', type: 'Expense', detailType: 'Fixed Asset', balance: '80000.00', mapping: { taxAccountType: 'TEMP_FIXED_ASSET_ALLOWANCE', bookTreatment: 'temporary', timingCategory: 'taxable_temporary' } },
  { externalId: '6100', number: '6100', name: 'Depreciation - Equipment', type: 'Expense', detailType: 'Fixed Asset', balance: '60000.00', mapping: { taxAccountType: 'TEMP_FIXED_ASSET_ALLOWANCE', bookTreatment: 'temporary', timingCategory: 'taxable_temporary' } },
  { externalId: '6200', number: '6200', name: 'Amortization - Intangibles', type: 'Expense', detailType: 'Fixed Asset', balance: '40000.00', mapping: { taxAccountType: 'TEMP_TIMING_DIFFERENCE', bookTreatment: 'temporary', timingCategory: 'taxable_temporary' } },
  { externalId: '7000', number: '7000', name: 'Meals and Entertainment', type: 'Expense', detailType: 'Expense', balance: '10000.00', mapping: { taxAccountType: 'PERM_OTHER', bookTreatment: 'permanent' } },
  { externalId: '7100', number: '7100', name: 'Fines and Penalties', type: 'Expense', detailType: 'Expense', balance: '5000.00', mapping: { taxAccountType: 'PERM_OTHER', bookTreatment: 'permanent' } },
  { externalId: '7200', number: '7200', name: 'Political Contributions', type: 'Expense', detailType: 'Expense', balance: '2000.00', mapping: { taxAccountType: 'PERM_OTHER', bookTreatment: 'permanent' } },
  { externalId: '8000', number: '8000', name: 'Bad Debt Reserve', type: 'Expense', detailType: 'Expense', balance: '15000.00', mapping: { taxAccountType: 'TEMP_TIMING_DIFFERENCE', bookTreatment: 'temporary', timingCategory: 'deductible_temporary' } },
  { externalId: '8100', number: '8100', name: 'Warranty Reserve', type: 'Expense', detailType: 'Expense', balance: '8000.00', mapping: { taxAccountType: 'TEMP_TIMING_DIFFERENCE', bookTreatment: 'temporary', timingCategory: 'deductible_temporary' } },
  { externalId: '9000', number: '9000', name: 'Interest Income', type: 'Income', detailType: 'Income', balance: '-20000.00', mapping: { taxAccountType: 'NODIFF_INTEREST_INCOME', bookTreatment: 'no_diff' } },
];

demoRoutes.use('*', authMiddleware);

demoRoutes.post('/seed', async (c) => {
  const user = c.get('user');

  return withTenantContext(user.tenantId, async (tx) => {
    const existing = await tx.select().from(trialBalance).where(eq(trialBalance.tenantId, user.tenantId)).limit(1);
    if (existing.length > 0) {
      throw new BadRequestError('Demo data already exists for this tenant. Clear trial balance first.');
    }

    const entity = await tx.insert(entities).values({
      tenantId: user.tenantId,
      externalId: 'demo-entity-greggs',
      name: 'Greggs plc (Demo)',
      type: 'Corporation',
      currency: 'GBP',
      taxJurisdiction: 'UK_FRS102',
    }).returning().then(r => r[0]);

    const createdAccounts: Record<string, string> = {};
    for (const acct of demoAccounts) {
      const [row] = await tx.insert(accounts).values({
        tenantId: user.tenantId,
        externalId: acct.externalId,
        accountNumber: acct.number,
        name: acct.name,
        type: acct.type,
        detailType: acct.detailType,
      }).returning();
      createdAccounts[acct.externalId] = row.id;
    }

    for (const acct of demoAccounts) {
      const accountId = createdAccounts[acct.externalId];
      await tx.insert(taxMappings).values({
        tenantId: user.tenantId,
        accountId,
        taxAccountType: acct.mapping.taxAccountType,
        bookTreatment: acct.mapping.bookTreatment,
        timingCategory: acct.mapping.timingCategory || null,
        confidenceScore: '0.85',
        suggestedByAi: true,
        status: 'active',
        version: 1,
      });

      await tx.insert(trialBalance).values({
        tenantId: user.tenantId,
        entityId: entity.id,
        accountId,
        period: DEMO_PERIOD,
        periodEnd: DEMO_PERIOD_END,
        fiscalYear: DEMO_FISCAL_YEAR,
        fiscalPeriod: DEMO_FISCAL_PERIOD,
        debit: parseFloat(acct.balance) > 0 ? acct.balance : '0',
        credit: parseFloat(acct.balance) < 0 ? Math.abs(parseFloat(acct.balance)).toString() : '0',
        balance: acct.balance,
        source: 'demo',
      });
    }

    const totalIncome = demoAccounts.filter(a => a.type === 'Income').reduce((s, a) => s - parseFloat(a.balance), 0);
    const totalExpenses = demoAccounts.filter(a => a.type === 'Expense').reduce((s, a) => s + parseFloat(a.balance), 0);
    const pbt = totalIncome - totalExpenses;
    const netTemporary = demoAccounts
      .filter(a => a.mapping.bookTreatment === 'temporary')
      .reduce((s, a) => s + (a.mapping.timingCategory === 'taxable_temporary' ? parseFloat(a.balance) : -parseFloat(a.balance)), 0);
    const expectedDtl = Math.round(netTemporary * 0.25 * 100) / 100;

    return c.json({
      message: 'Demo data loaded — Greggs plc synthetic trial balance',
      entity: { id: entity.id, name: entity.name },
      accounts: demoAccounts.length,
      summary: { totalIncome, totalExpenses, pbt },
      nextStep: `Run "Provision" to calculate tax — expect ~£${expectedDtl.toLocaleString('en-GB')} deferred DTL (25% main rate)`,
    });
  });
});
