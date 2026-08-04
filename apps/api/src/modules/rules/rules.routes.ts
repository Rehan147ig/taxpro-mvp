import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, lte, gte, isNull, or } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { ukRules } from '../../db/schema/uk-rules.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { getUser, requireRole } from '../../lib/middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

export const ruleRoutes = new Hono();
ruleRoutes.use('*', authMiddleware);

const ruleProposalSchema = z.object({
  ruleKey: z.string().min(1).max(100),
  jurisdiction: z.string().max(30).default('UK_FRS102'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sourceUrl: z.string().url().max(500).optional(),
  sourceSnapshotHash: z.string().max(64).optional(),
  author: z.string().max(255).optional(),
  version: z.number().int().positive().default(1),
  testFixtureRef: z.string().max(255).optional(),
  changeRationale: z.string().min(1).max(2000),
});

const supersedeSchema = ruleProposalSchema.omit({ version: true });

/**
 * The rules a calculation used. Runs record exactly this set at creation
 * time from approved registry entries — it is never derived from AI or
 * live web results.
 */
export async function resolveRulesUsed(tx: any, tenantId: string, asOf: string): Promise<Array<{
  ruleKey: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUrl: string | null;
}>> {
  const rows = await tx.select({
    ruleKey: ukRules.ruleKey,
    version: ukRules.version,
    effectiveFrom: ukRules.effectiveFrom,
    effectiveTo: ukRules.effectiveTo,
    sourceUrl: ukRules.sourceUrl,
  }).from(ukRules)
    .where(and(
      eq(ukRules.tenantId, tenantId),
      eq(ukRules.approvalState, 'approved'),
      lte(ukRules.effectiveFrom, asOf),
      or(isNull(ukRules.effectiveTo), gte(ukRules.effectiveTo, asOf)),
    ))
    .orderBy(ukRules.ruleKey, ukRules.version);
  return rows;
}

// ── List the registry ──
ruleRoutes.get('/', async (c) => {
  const user = getUser(c);
  const jurisdiction = c.req.query('jurisdiction');
  return withTenantContext(user.tenantId, async (tx) => {
    const rows = await tx.select().from(ukRules)
      .where(and(eq(ukRules.tenantId, user.tenantId), jurisdiction ? eq(ukRules.jurisdiction, jurisdiction) : undefined))
      .orderBy(ukRules.ruleKey, desc(ukRules.version));
    return c.json(rows);
  });
});

// ── AI research / rules / humans create proposals only ──
// Nothing in this endpoint (or any AI path) applies a rule automatically:
// a rule must be approved by a partner/admin before any calculation
// records it as used.
ruleRoutes.post('/proposals', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', ruleProposalSchema), async (c) => {
    const user = getUser(c);
    const body = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const [rule] = await tx.insert(ukRules).values({
        tenantId: user.tenantId,
        ruleKey: body.ruleKey,
        jurisdiction: body.jurisdiction,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
        sourceUrl: body.sourceUrl ?? null,
        sourceSnapshotHash: body.sourceSnapshotHash ?? null,
        author: body.author ?? null,
        approvalState: 'proposal',
        version: body.version,
        testFixtureRef: body.testFixtureRef ?? null,
        changeRationale: body.changeRationale,
      }).returning();
      return c.json(rule, 201);
    });
  });

// ── Partner/admin approval ──
ruleRoutes.post('/:id/approve', requireRole('partner', 'admin'), async (c) => {
  const user = getUser(c);
  const { id } = c.req.param();
  return withTenantContext(user.tenantId, async (tx) => {
    const [rule] = await tx.update(ukRules).set({
      approvalState: 'approved',
      approvedByUserId: user.userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(ukRules.id, id), eq(ukRules.tenantId, user.tenantId)))
      .returning();
    if (!rule) throw new NotFoundError('UK rule', id);
    return c.json(rule);
  });
});

// ── Rollback (records rationale; does not delete history) ──
ruleRoutes.post('/:id/rollback', requireRole('partner', 'admin'),
  zValidator('json', z.object({ rationale: z.string().min(1).max(2000) })), async (c) => {
    const user = getUser(c);
    const { id } = c.req.param();
    const { rationale } = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const [rule] = await tx.update(ukRules).set({
        approvalState: 'rolled_back',
        changeRationale: rationale,
        updatedAt: new Date(),
      }).where(and(eq(ukRules.id, id), eq(ukRules.tenantId, user.tenantId)))
        .returning();
      if (!rule) throw new NotFoundError('UK rule', id);
      return c.json(rule);
    });
  });

// ── Supersede: new version of a rule, chained to the old one ──
ruleRoutes.post('/:id/supersede', requireRole('partner', 'admin'),
  zValidator('json', supersedeSchema), async (c) => {
    const user = getUser(c);
    const { id } = c.req.param();
    const body = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const [current] = await tx.select().from(ukRules)
        .where(and(eq(ukRules.id, id), eq(ukRules.tenantId, user.tenantId)))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundError('UK rule', id);
      if (current.approvalState === 'rolled_back') {
        throw new BadRequestError('A rolled-back rule cannot be superseded');
      }

      const [next] = await tx.insert(ukRules).values({
        tenantId: user.tenantId,
        ruleKey: body.ruleKey,
        jurisdiction: body.jurisdiction,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
        sourceUrl: body.sourceUrl ?? null,
        sourceSnapshotHash: body.sourceSnapshotHash ?? null,
        author: body.author ?? null,
        approvalState: 'proposal',
        version: current.version + 1,
        testFixtureRef: body.testFixtureRef ?? null,
        changeRationale: body.changeRationale,
        supersedesRuleId: current.id,
      }).returning();

      await tx.update(ukRules).set({ approvalState: 'superseded', updatedAt: new Date() })
        .where(eq(ukRules.id, current.id));

      return c.json(next, 201);
    });
  });
