// ── GL Heuristics — deterministic narrative flagging ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.
//
// These are DETERMINISTIC regex heuristics over transaction narration/memo
// text. They produce ReviewItem-style findings for a human tax reviewer.
// They are NOT a determination of deductibility.

export type GlFlagCode =
  | 'NON_DEDUCTIBLE_ENTERTAINMENT'
  | 'PENALTIES_OR_FINES'
  | 'GIFTS_LIMITED_DEDUCTION'
  | 'HOTEL_LODGING_REVIEW'
  | 'EMPTY_NARRATION'
  | 'TAX_TAG_OVERRIDE';

export interface GlFinding {
  /** Stable machine code for the finding. */
  flag: GlFlagCode;
  /**
   * Human-readable reason phrased as an assumed rule — the phrasing is a
   * guess and must be corrected by a domain expert.
   */
  reason: string;
  /** The narration text the regex matched, or null for non-regex flags. */
  matchedText: string | null;
  /**
   * hard_flag = likely non-deductible or non-reviewable without detail;
   * review = look closer (deductible in some circumstances).
   */
  severity: 'hard_flag' | 'review';
}

export interface HeuristicRule {
  flag: GlFlagCode;
  description: string;
  pattern: RegExp;
  severity: 'hard_flag' | 'review';
  /**
   * Tells the reader exactly how to falsify this pattern. Every pattern in
   * this file was written from memory of public material, never validated
   * against a real ERP export.
   */
  verifyNote: string;
}

/**
 * The rules, in evaluation order. Each pattern carries the same verification
 * note because NONE of them has been validated yet.
 */
export const GL_HEURISTIC_RULES: readonly HeuristicRule[] = [
  {
    flag: 'NON_DEDUCTIBLE_ENTERTAINMENT',
    description:
      'Assumed rule: client/social entertainment is largely non-deductible in the US (commonly referenced as IRC §274 disallowance, with a limited 50% meals treatment) and fully disallowed in the UK (commonly referenced as CTA 2009 s.1298). A flagged narration is sent for human review, not auto-disallowed.',
    pattern:
      /\b(entertain(?:ment|ing)?|client (?:meal|lunch|dinner)|business meal|happy hour|bar tab|booze|golf (?:outing|day)|corporate event|team outing|wine tasting)\b/i,
    severity: 'hard_flag',
    verifyNote:
      'guessed pattern — verify against real narration text from an actual ERP export before trusting.',
  },
  {
    flag: 'PENALTIES_OR_FINES',
    description:
      'Assumed rule: penalties and fines are generally non-deductible (commonly referenced as IRC §162(f) for the US). Flagged for human review because some fines/civil penalties are deductible.',
    pattern:
      /\b(penalt|late filing|late payment|interest penalty|civil (?:fine|penalty)|citation|speeding ticket|parking ticket|red light|violation (?:fee|charge|fine)|surcharge)\b/i,
    severity: 'hard_flag',
    verifyNote:
      'guessed pattern — verify against real narration text from an actual ERP export before trusting.',
  },
  {
    flag: 'GIFTS_LIMITED_DEDUCTION',
    description:
      'Assumed rule: business gifts are limited (commonly referenced as the US $25-per-recipient annual cap under IRC §274(b); the UK has no direct equivalent cap but gifts to individuals are often disallowed). Flagged for human review.',
    pattern: /\b(gift|present|thank you (?:gift|card)|holiday (?:gift|card)|gift basket|gift card)\b/i,
    severity: 'hard_flag',
    verifyNote:
      'guessed pattern — verify against real narration text from an actual ERP export before trusting.',
  },
  {
    flag: 'HOTEL_LODGING_REVIEW',
    description:
      'Assumed rule: hotel/lodging is deductible as ordinary business travel in many circumstances but is frequently misclassified or personal. Review-only severity.',
    pattern: /\b(hotel|lodging|stay|airbnb|bed and breakfast|bnb)\b/i,
    severity: 'review',
    verifyNote:
      'guessed pattern — verify against real narration text from an actual ERP export before trusting.',
  },
];

/**
 * Flags one transaction from its narration and any manual tag overrides.
 * Deterministic, pure, never throws.
 *
 * `taxTagOverrides` are assumed to express human annotations; their presence
 * suppresses only the matching-flag noise by adding a review note instead of
 * another hard flag (semantics guessed, UNVALIDATED).
 */
export function flagGlTransaction(input: {
  narration?: string | null;
  taxTagOverrides?: string[];
}): GlFinding[] {
  const findings: GlFinding[] = [];
  const narration = input.narration?.trim() ?? '';

  if (narration.length === 0) {
    findings.push({
      flag: 'EMPTY_NARRATION',
      reason: 'No narration — deductibility cannot be assessed. Assumed rule: flag every narration-less GL row for review.',
      matchedText: null,
      severity: 'hard_flag',
    });
  }

  for (const rule of GL_HEURISTIC_RULES) {
    const match = narration.match(rule.pattern);
    if (match) {
      findings.push({
        flag: rule.flag,
        reason: rule.description,
        matchedText: match[0],
        severity: rule.severity,
      });
    }
  }

  if (input.taxTagOverrides && input.taxTagOverrides.length > 0) {
    findings.push({
      flag: 'TAX_TAG_OVERRIDE',
      reason: 'Manual tax tag overrides exist for this row; assumed rule: human annotation wins over heuristics — reviewer should confirm the override is current.',
      matchedText: null,
      severity: 'review',
    });
  }

  return findings;
}
