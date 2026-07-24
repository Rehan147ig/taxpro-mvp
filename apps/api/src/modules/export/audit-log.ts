export interface AuditTrailEntry {
  timestamp: string;
  eventType: string;
  actor?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

/**
 * In-memory audit log accumulator for a single provision run.
 * Start one via createAuditLog() for each run, call .add() throughout
 * the lifecycle, then pass .entries to the package exporter.
 */
export function createAuditLog() {
  const entries: AuditTrailEntry[] = [];

  return {
    add(eventType: string, description: string, metadata?: Record<string, unknown>, actor?: string) {
      entries.push({
        timestamp: new Date().toISOString(),
        eventType,
        actor,
        description,
        metadata,
      });
    },
    get entries(): AuditTrailEntry[] {
      return entries;
    },
  };
}
