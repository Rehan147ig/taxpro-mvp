import { describe, it, expect } from 'vitest';
import {
  reviewTransitionError,
  REVIEW_ITEM_STATUSES,
  REVIEW_ITEM_FINAL_STATUSES,
} from '../modules/review/review-lifecycle.js';

describe('Phase B — review lifecycle (open/in_progress/waiting_for_evidence/resolved/waived)', () => {

  it('exposes exactly the five mission statuses (plus rejected for legacy)', () => {
    expect(REVIEW_ITEM_STATUSES).toEqual([
      'open',
      'in_progress',
      'waiting_for_evidence',
      'resolved',
      'rejected',
      'waived',
    ]);
  });

  it('allows open → in_progress → waiting_for_evidence → in_progress', () => {
    expect(reviewTransitionError('open', 'in_progress')).toBeNull();
    expect(reviewTransitionError('in_progress', 'waiting_for_evidence')).toBeNull();
    expect(reviewTransitionError('waiting_for_evidence', 'in_progress')).toBeNull();
  });

  it('allows closing any active status to resolved/rejected/waived', () => {
    for (const from of ['open', 'in_progress', 'waiting_for_evidence']) {
      expect(reviewTransitionError(from, 'resolved'), `${from} → resolved`).toBeNull();
      expect(reviewTransitionError(from, 'rejected'), `${from} → rejected`).toBeNull();
      expect(reviewTransitionError(from, 'waived'), `${from} → waived`).toBeNull();
    }
  });

  it('waived is a final status and cannot be silently reopened', () => {
    expect(REVIEW_ITEM_FINAL_STATUSES).toContain('waived');
    expect(reviewTransitionError('waived', 'open')).toMatch(/reopen is required/);
    expect(reviewTransitionError('resolved', 'open')).toMatch(/reopen is required/);
  });

  it('rejects illegal transitions between active statuses', () => {
    expect(reviewTransitionError('in_progress', 'open')).toMatch(/Illegal/);
    expect(reviewTransitionError('waiting_for_evidence', 'open')).toMatch(/Illegal/);
    expect(reviewTransitionError('waiting_for_evidence', 'waiting_for_evidence')).toMatch(/Illegal/);
    expect(reviewTransitionError('open', 'open')).toMatch(/Illegal/);
  });

  it('rejects unknown statuses', () => {
    expect(reviewTransitionError('gone', 'resolved')).toMatch(/Unknown status/);
    expect(reviewTransitionError('open', 'reviewed_forever')).toMatch(/Unknown status/);
  });
});
