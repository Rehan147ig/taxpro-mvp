// ── GL ELT Pipeline — extract / transform / load, chunked ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.
//
// The pipeline:
//   1. EXTRACT  — accepts canonical `GlRowInput` rows (see `./adapters.js`);
//                 adapter normalizers run before this stage.
//   2. TRANSFORM — coerces amounts to Decimal, validates required fields.
//   3. FLAG     — runs the deterministic narration heuristics.
//   4. LOAD     — optional caller-supplied sink; the default is a no-op
//                 because wiring a real database is out of scope.
//
// Rows are processed in chunks to keep memory bounded for large GL exports.
// The default chunk size (5,000) is a GUESS picked from no measurement; real
// deployments should tune it.

import { Decimal } from 'decimal.js';
import type { GlRowInput } from './adapters.js';
import { flagGlTransaction } from './heuristics.js';
import type { GlFinding } from './heuristics.js';

/** Canonical in-memory row after extract/transform. */
export interface GlNormalizedTransaction {
  tenantId: string;
  accountId: string;
  transactionDate: string;
  sourceErp: string;
  amount: Decimal;
  currency: string;
  narration: string | null;
  rawPayload: unknown;
  taxTagOverrides: string[];
}

export interface GlSkippedRow {
  rowIndex: number;
  reason: string;
}

export interface GlEltChunkResult {
  rows: GlNormalizedTransaction[];
  findings: GlFinding[];
}

export interface GlEltResult {
  chunks: number;
  processed: number;
  skipped: GlSkippedRow[];
  normalized: GlNormalizedTransaction[];
  findings: GlFinding[];
}

export interface GlEltOptions {
  /**
   * Rows per chunk. Assumed default 5,000 — a guess, not a measured optimum.
   */
  chunkSize?: number;
  /**
   * Optional sink per chunk. When omitted the load stage is a no-op.
   * Assumed signature: callers that wire a real DB insert here. Any error
   * propagates and aborts the pipeline (assumed to be desired for an ELT
   * load stage).
   */
  load?: (chunk: GlNormalizedTransaction[]) => Promise<void> | void;
  /** Optional per-chunk observation hook (e.g. progress logging). */
  onChunk?: (chunkIndex: number, result: GlEltChunkResult) => Promise<void> | void;
}

export const DEFAULT_GL_CHUNK_SIZE = 5000;

function normalizeRow(input: GlRowInput): { row: GlNormalizedTransaction | null; reason: string | null } {
  const missing: string[] = [];
  if (!input.tenantId) missing.push('tenantId');
  if (!input.accountId) missing.push('accountId');
  if (!input.transactionDate) missing.push('transactionDate');
  if (!input.sourceErp) missing.push('sourceErp');
  if (missing.length > 0) {
    return { row: null, reason: `missing required field(s): ${missing.join(', ')}` };
  }

  let amount: Decimal;
  try {
    amount = new Decimal(input.amount);
  } catch {
    return { row: null, reason: `amount '${String(input.amount)}' is not a number` };
  }
  if (!amount.isFinite()) {
    return { row: null, reason: `amount '${String(input.amount)}' is not finite` };
  }

  return {
    row: {
      tenantId: input.tenantId,
      accountId: input.accountId,
      transactionDate: input.transactionDate,
      sourceErp: input.sourceErp,
      amount,
      currency: input.currency ?? 'USD',
      narration: input.narration ?? null,
      rawPayload: input.rawPayload,
      taxTagOverrides: input.taxTagOverrides ?? [],
    },
    reason: null,
  };
}

/**
 * Runs the ELT pipeline over all rows. Deterministic: rows are processed in
 * input order, chunks sequentially. Never throws for data problems (bad rows
 * are skipped and reported); throws only if a caller-supplied `load` throws.
 */
export async function runGlEltPipeline(rows: GlRowInput[], options: GlEltOptions = {}): Promise<GlEltResult> {
  const chunkSize = options.chunkSize ?? DEFAULT_GL_CHUNK_SIZE;
  const normalized: GlNormalizedTransaction[] = [];
  const skipped: GlSkippedRow[] = [];
  const findings: GlFinding[] = [];

  const chunkCount = Math.ceil(rows.length / chunkSize);
  for (let i = 0; i < chunkCount; i += 1) {
    const slice = rows.slice(i * chunkSize, (i + 1) * chunkSize);
    const chunkRows: GlNormalizedTransaction[] = [];
    const chunkFindings: GlFinding[] = [];

    for (let j = 0; j < slice.length; j += 1) {
      const rowIndex = i * chunkSize + j;
      const normalizedRow = normalizeRow(slice[j]);
      if (normalizedRow.row === null) {
        skipped.push({ rowIndex, reason: normalizedRow.reason as string });
        continue;
      }
      chunkRows.push(normalizedRow.row);
      chunkFindings.push(...flagGlTransaction({ narration: normalizedRow.row.narration, taxTagOverrides: normalizedRow.row.taxTagOverrides }));
    }

    normalized.push(...chunkRows);
    findings.push(...chunkFindings);

    if (options.load) {
      await options.load(chunkRows);
    }
    if (options.onChunk) {
      await options.onChunk(i, { rows: chunkRows, findings: chunkFindings });
    }
  }

  return { chunks: chunkCount, processed: normalized.length, skipped, normalized, findings };
}
