import { z } from 'zod';

/**
 * QuickBooks Online is a UK accounting-data source too, so the connector is
 * never hidden behind TAXPRO_ENABLE_US. The UK defaults below make a fresh
 * QBO sync produce a UK FRS 102 entity in GBP; callers who operate a US
 * entity may pass US values explicitly (US-specific mappings/tax workflows
 * remain gated by TAXPRO_ENABLE_US at the engine/export layer).
 */
export const DEFAULT_SYNC_JURISDICTION = 'UK_FRS102';
export const DEFAULT_SYNC_CURRENCY = 'GBP';

export const syncParamsSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityName: z.string().max(255).optional(),
  jurisdiction: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, 'Jurisdiction may only contain letters, numbers, underscores and hyphens')
    .default(DEFAULT_SYNC_JURISDICTION),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter ISO code')
    .default(DEFAULT_SYNC_CURRENCY),
});
