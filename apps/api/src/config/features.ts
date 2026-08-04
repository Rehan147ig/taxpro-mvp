import { env } from './env.js';

/**
 * US ASC 740 workstream enablement.
 *
 * TaxPro is a UK-first product (FRS 102 Section 29). The US code path is
 * preserved and tested but dormant by default: US connectors, exports and
 * jurisdiction defaults are gated behind `TAXPRO_ENABLE_US=true` and hidden
 * from the default UX. See docs/UK_PRODUCT_ARCHITECTURE.md.
 */
export const enableUsWorkstream = env.TAXPRO_ENABLE_US === 'true';
