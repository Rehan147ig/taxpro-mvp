export const REVIEW_ITEM_STATUSES = ['open', 'in_progress', 'waiting_for_evidence', 'resolved', 'rejected', 'waived'] as const;

export type ReviewItemStatus = (typeof REVIEW_ITEM_STATUSES)[number];

export const REVIEW_ITEM_FINAL_STATUSES: ReviewItemStatus[] = ['resolved', 'rejected', 'waived'];

const TRANSITIONS: Record<ReviewItemStatus, ReviewItemStatus[]> = {
  open: ['in_progress', 'waiting_for_evidence', 'resolved', 'rejected', 'waived'],
  in_progress: ['waiting_for_evidence', 'resolved', 'rejected', 'waived'],
  waiting_for_evidence: ['in_progress', 'resolved', 'rejected', 'waived'],
  resolved: [],
  rejected: [],
  waived: [],
};

/**
 * Phase B review lifecycle rules.
 *
 * - Every non-final status can be closed to resolved/rejected/waived.
 * - Only a human can waive (enforced by the route: partner/admin role +
 *   mandatory reason) — this rule set only defines the legal moves.
 * - A final status can only be left via an explicit reopen (separate
 *   endpoint), which is always recorded in the append-only event trail.
 *
 * Returns an error message when the transition is illegal, or null when it
 * is allowed.
 */
export function reviewTransitionError(from: string, to: string): string | null {
  if (!(REVIEW_ITEM_STATUSES as readonly string[]).includes(from)) {
    return `Unknown status '${from}'`;
  }
  if (!(REVIEW_ITEM_STATUSES as readonly string[]).includes(to)) {
    return `Unknown status '${to}'`;
  }
  const allowed = TRANSITIONS[from as ReviewItemStatus];
  if (!allowed.includes(to as ReviewItemStatus)) {
    if (REVIEW_ITEM_FINAL_STATUSES.includes(from as ReviewItemStatus)) {
      return `Cannot move a final status ('${from}') to '${to}'; reopen is required`;
    }
    return `Illegal review-item transition '${from}' → '${to}'`;
  }
  return null;
}
