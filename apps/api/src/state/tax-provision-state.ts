import type { Jurisdiction } from '../../packages/tax-engine/src/types.js';

export type PipelineStage = 'parse' | 'map' | 'calculate' | 'explain' | 'audit' | 'review' | 'locked';

export type HumanReviewStatus = 'pending' | 'approved' | 'overridden';

export interface ParsedItem {
  accountNumber: string;
  accountName: string;
  accountType: 'Income' | 'Expense' | 'Asset' | 'Liability' | 'Equity';
  debit: string;
  credit: string;
  balance: string;
  period: string;
  entityId: string;
}

export interface MappedItem {
  accountNumber: string;
  taxAccountType: string;
  bookTreatment: 'permanent' | 'temporary' | 'no_diff';
  timingCategory?: string;
  confidenceScore: number;
  rationale: string;
}

export interface EngineOutput {
  currentTax: Record<string, unknown>;
  deferredTax: Record<string, unknown>;
  etr: Record<string, unknown>;
}

export interface Explanation {
  section: string;
  summary: string;
  detail: string;
  citations: { rule: string; reference: string }[];
}

export interface AuditFlag {
  severity: 'critical' | 'warning' | 'info';
  category: 'variance' | 'compliance' | 'disclosure' | 'consistency';
  description: string;
  detail: string;
  recommendation: string;
  etrDeltaBp?: number;
}

export interface TaxProvisionState {
  jobId: string;
  jurisdiction: string;
  stage: PipelineStage;
  parsedItems: ParsedItem[];
  mappedItems: MappedItem[];
  engineOutput: EngineOutput | null;
  explanations: Explanation[];
  auditFlags: AuditFlag[];
  humanReview: HumanReviewStatus;
  locked: boolean;
  rawInput?: string;
}

export function assertNotLocked(state: TaxProvisionState): void {
  if (state.locked) {
    throw new Error('Provision is locked. Cannot modify.');
  }
}

export function transitionStage(
  current: TaxProvisionState,
  target: PipelineStage,
  allowed: PipelineStage[],
): TaxProvisionState {
  assertNotLocked(current);
  if (!allowed.includes(current.stage)) {
    throw new Error(`Cannot transition from ${current.stage} to ${target}`);
  }
  return { ...current, stage: target };
}
