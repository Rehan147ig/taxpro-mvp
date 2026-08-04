import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { mappingProposals } from '../../db/schema/mapping-proposals.js';
import { taxMappings } from '../../db/schema/tax-mappings.js';
import { accounts } from '../../db/schema/accounts.js';
import { entities } from '../../db/schema/entities.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { getUser, requireRole } from '../../lib/middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { validateUkClassification } from './uk-taxonomy.js';

export const mappingProposalRoutes = new Hono();
mappingProposalRoutes.use('*', authMiddleware);

const PROPOSAL_SOURCES = ['ai', 'rules', 'manual', 'import', 'carry_forward'] as const;
const DECISIONS = ['approved', 'rejected'] as const;

const createProposalSchema = z.object({
  entityId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  sourceAccountExternalId: z.string().min(1).max(100),
  sourceAccountName: z.string().max(255).optional(),
  targetTaxClassification: z.string().min(1),
  bookTreatment: z.enum(['permanent', 'temporary', 'no_diff', 'manual_review']),
  timingCategory: z.string().max(50).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  proposalSource: z.enum(PROPOSAL_SOURCES),
  reason: z.string().max(2000).optional(),
});

// ── List proposals ──
mappingProposalRoutes.get('/proposals', async (c) => {
  const user = getUser(c);
  const status = c.req.query('status');
  const entityId = c.req.query('entityId');
  return withTenantContext(user.tenantId, async (tx) => {
    const conditions = [eq(mappingProposals.tenantId, user.tenantId)];
    if (status && ['pending', 'approved', 'rejected', 'superseded'].includes(status)) {
      conditions.push(eq(mappingProposals.status, status));
    }
    if (entityId) conditions.push(eq(mappingProposals.entityId, entityId));
    const rows = await tx.select().from(mappingProposals)
      .where(and(...conditions))
      .orderBy(desc(mappingProposals.createdAt));
    return c.json(rows);
  });
});

// ── Create a proposal (AI/rules/manual/import may propose; never decide) ──
mappingProposalRoutes.post('/proposals', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', createProposalSchema), async (c) => {
    const user = getUser(c);
    const body = c.req.valid('json');

    // AI can propose a mapping only. A proposal can never become an approved
    // mapping silently: it is always created pending and requires a human
    // decision (POST /proposals/:id/decide).
    const target = validateUkClassification(body.targetTaxClassification);

    return withTenantContext(user.tenantId, async (tx) => {
      if (body.entityId) {
        const [entity] = await tx.select({ id: entities.id }).from(entities)
          .where(and(eq(entities.id, body.entityId), eq(entities.tenantId, user.tenantId))).limit(1);
        if (!entity) throw new BadRequestError('Entity not found in this tenant');
      }
      if (body.accountId) {
        const [account] = await tx.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.id, body.accountId), eq(accounts.tenantId, user.tenantId))).limit(1);
        if (!account) throw new BadRequestError('Account not found in this tenant');
      }

      const [proposal] = await tx.insert(mappingProposals).values({
        tenantId: user.tenantId,
        entityId: body.entityId ?? null,
        accountId: body.accountId ?? null,
        sourceAccountExternalId: body.sourceAccountExternalId,
        sourceAccountName: body.sourceAccountName ?? null,
        targetTaxClassification: target,
        bookTreatment: body.bookTreatment,
        timingCategory: body.timingCategory ?? null,
        confidenceScore: body.confidenceScore !== undefined ? String(body.confidenceScore) : null,
        proposalSource: body.proposalSource,
        status: 'pending',
        version: 1,
        carriesForward: false,
        decisionReason: body.reason ?? null,
      }).returning();
      return c.json(proposal, 201);
    });
  });

const decideSchema = z.object({
  decision: z.enum(DECISIONS),
  reason: z.string().min(1, 'A decision reason is required for the audit trail').max(2000),
});

// ── Human decision on a proposal (approve applies; reject records) ──
mappingProposalRoutes.post('/proposals/:id/decide', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', decideSchema), async (c) => {
    const user = getUser(c);
    const { decision, reason } = c.req.valid('json');

    return withTenantContext(user.tenantId, async (tx) => {
      const [proposal] = await tx.select().from(mappingProposals)
        .where(and(eq(mappingProposals.id, c.req.param('id')), eq(mappingProposals.tenantId, user.tenantId)))
        .for('update')
        .limit(1);
      if (!proposal) throw new NotFoundError('Mapping proposal', c.req.param('id'));
      if (proposal.status !== 'pending') {
        throw new BadRequestError(`Only pending proposals can be decided (current status: ${proposal.status})`);
      }

      const now = new Date();
      await tx.update(mappingProposals).set({
        status: decision,
        reviewerUserId: user.userId,
        reviewerDecision: decision,
        decisionReason: reason,
        decidedAt: now,
        updatedAt: now,
      }).where(eq(mappingProposals.id, proposal.id));

      if (decision === 'approved' && proposal.accountId) {
        // Human approval applies the mapping as a new versioned tax_mappings
        // row, superseding any previously active mapping for the account.
        const [current] = await tx.select().from(taxMappings)
          .where(and(eq(taxMappings.tenantId, user.tenantId), eq(taxMappings.accountId, proposal.accountId)))
          .orderBy(desc(taxMappings.version))
          .limit(1);
        const newVersion = (current?.version ?? 0) + 1;
        if (current) {
          await tx.update(taxMappings).set({ isActive: false, updatedAt: now })
            .where(eq(taxMappings.id, current.id));
        }
        await tx.insert(taxMappings).values({
          tenantId: user.tenantId,
          accountId: proposal.accountId,
          taxAccountType: proposal.targetTaxClassification,
          bookTreatment: proposal.bookTreatment,
          timingCategory: proposal.timingCategory ?? null,
          confidenceScore: '1.0',
          suggestedByAi: false,
          overrideReason: reason,
          isActive: true,
          status: 'active',
          version: newVersion,
        });
      }

      return c.json({
        id: proposal.id,
        status: decision,
        reviewerUserId: user.userId,
        decidedAt: now.toISOString(),
        applied: decision === 'approved' && !!proposal.accountId,
      });
    });
  });

// ── Carry prior-year approved mappings forward as proposals ──
// Approved mappings from a prior year become proposals requiring
// confirmation; they are never copied silently into the new period.
mappingProposalRoutes.post('/proposals/carry-forward', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({
    entityId: z.string().uuid(),
  })), async (c) => {
    const user = getUser(c);
    const { entityId } = c.req.valid('json');

    return withTenantContext(user.tenantId, async (tx) => {
      const [entity] = await tx.select({ id: entities.id, name: entities.name }).from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.tenantId, user.tenantId))).limit(1);
      if (!entity) throw new BadRequestError('Entity not found in this tenant');

      const accountRows = await tx.select({
        accountId: accounts.id,
        externalId: accounts.externalId,
        name: accounts.name,
      }).from(accounts)
        .innerJoin(taxMappings, eq(taxMappings.accountId, accounts.id))
        .where(and(
          eq(taxMappings.tenantId, user.tenantId),
          eq(taxMappings.isActive, true),
        ));

      // Skip accounts that already have an open carry-forward proposal.
      const pendingRows = await tx.select({ accountId: mappingProposals.accountId }).from(mappingProposals)
        .where(and(
          eq(mappingProposals.tenantId, user.tenantId),
          eq(mappingProposals.proposalSource, 'carry_forward'),
          eq(mappingProposals.status, 'pending'),
        ));
      const alreadyPending = new Set(pendingRows.map((r) => r.accountId));

      let created = 0;
      const skips: string[] = [];
      for (const account of accountRows) {
        const [mapping] = await tx.select().from(taxMappings)
          .where(and(
            eq(taxMappings.tenantId, user.tenantId),
            eq(taxMappings.accountId, account.accountId),
            eq(taxMappings.isActive, true),
          ))
          .orderBy(desc(taxMappings.version))
          .limit(1);
        if (!mapping) continue;
        if (alreadyPending.has(account.accountId)) {
          skips.push(account.externalId);
          continue;
        }
        await tx.insert(mappingProposals).values({
          tenantId: user.tenantId,
          entityId,
          accountId: account.accountId,
          sourceAccountExternalId: account.externalId,
          sourceAccountName: account.name,
          targetTaxClassification: mapping.taxAccountType,
          bookTreatment: mapping.bookTreatment,
          timingCategory: mapping.timingCategory ?? null,
          confidenceScore: '1.0',
          proposalSource: 'carry_forward',
          status: 'pending',
          version: 1,
          carriesForward: true,
          priorMappingId: mapping.id,
          decisionReason: `Carried forward from prior-year approved mapping v${mapping.version}`,
        });
        created++;
      }

      return c.json({
        entityId,
        entityName: entity.name,
        created,
        skippedAlreadyPending: skips.length,
        note: created === 0 && skips.length === 0
          ? 'No approved mappings found to carry forward for this entity.'
          : 'Carry-forward proposals are pending human confirmation and are not applied.',
      }, 201);
    });
  });
