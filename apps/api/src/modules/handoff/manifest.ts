// ─────────────────────────────────────────────────────────────────────────────
// Phase D — Filing-handoff evidence manifest (deterministic).
//
// A single JSON document that pins every fact an external reviewer needs to
// trust the package: identities, source-document hashes, mapping snapshot
// hash, rule versions, engine version, assumptions, approvals, review
// decisions, per-file export checksums, and the immutable generated time.
// The manifest is built ONLY from immutable run data (a locked run), so two
// exports of the same locked run produce byte-identical manifests — and the
// checksum recorded on an external filing record can be re-verified at any
// time. generatedAt is taken from the run's lockedAt, never from wall-clock
// time.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type { Ct600Violation } from '../export/ct600-validation.js';
import type { Ct600Return } from '../export/ct600.js';
import type { IxbrlValidationResult } from '../export/ixbrl-validation.js';

export const MANIFEST_SCHEMA_VERSION = '1.0.0';

export interface ManifestFileEntry {
  name: string;
  sha256: string;
  bytes: number;
}

export interface ManifestApprovals {
  approvalStatus: string;
  submittedAt: string | null;
  submittedByUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  lockedAt: string | null;
  lockedByUserId: string | null;
  handoffReadyAt: string | null;
  handoffReadyByUserId: string | null;
  filedExternallyAt: string | null;
  filedExternallyByUserId: string | null;
}

export interface ManifestReviewDecision {
  id: string;
  itemType: string;
  title: string;
  severity: string;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
}

export interface ManifestValidation {
  ct600: { valid: boolean; rulesRun: number; violations: Ct600Violation[]; skipped: Array<{ ruleId: string; reason: string }> };
  ixbrl: { included: boolean; valid: boolean | null; checksRun: number | null; violations: string[] } | null;
}

export interface HandoffManifestInput {
  tenantId: string;
  entity: { id: string; name: string; taxJurisdiction: string | null; currency: string | null; externalId: string | null } | null;
  periodStart: string;
  periodEnd: string;
  ct600Band?: { taxableIncome: number; charge: number; band: string; marginalRelief: number } | null;
  run: {
    id: string;
    engineVersion: string | null;
    rulesUsed: Record<string, unknown> | null;
    inputDataHash: string | null;
    mappingVersionHash: string | null;
    parentRunId: string | null;
    correlationId: string | null;
    idempotencyKey: string | null;
    status: string;
    approvalStatus: string;
    sourceDocumentId: string | null;
  };
  evidence: { id: string; filename: string; sha256: string; version: number } | null;
  assumptions: unknown;
  warnings: unknown;
  approvals: ManifestApprovals;
  reviewDecisions: ManifestReviewDecision[];
  validation: ManifestValidation;
  ct600: Ct600Return | null;
  exports: ManifestFileEntry[];
  selfExclusionRules: Array<{ path: string; reason: string }>;
}

export interface HandoffManifest {
  schemaVersion: string;
  kind: 'uk-filing-handoff-manifest';
  generatedAt: string;
  tenantId: string;
  entity: HandoffManifestInput['entity'];
  period: { start: string; end: string };
  run: HandoffManifestInput['run'];
  evidence: HandoffManifestInput['evidence'];
  mappingSnapshotHash: string | null;
  rulesUsed: Record<string, unknown> | null;
  engineVersion: string | null;
  assumptions: unknown;
  warnings: unknown;
  approvals: ManifestApprovals;
  reviewDecisions: ManifestReviewDecision[];
  validation: ManifestValidation;
  ct600Band: { taxableIncome: number; charge: number; band: string; marginalRelief: number } | null;
  exports: ManifestFileEntry[];
  selfExclusionRules: HandoffManifestInput['selfExclusionRules'];
  note: string;
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Build the manifest content and its own SHA-256. Pure and deterministic:
 * every field is derived from locked-run data; generatedAt is passed in and
 * must be an immutable run timestamp (lockedAt).
 */
export function buildHandoffManifest(input: HandoffManifestInput): { manifest: HandoffManifest; sha256: string } {
  const content: HandoffManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: 'uk-filing-handoff-manifest',
    generatedAt: input.approvals.lockedAt ?? input.approvals.approvedAt ?? '',
    tenantId: input.tenantId,
    entity: input.entity,
    period: { start: input.periodStart, end: input.periodEnd },
    run: input.run,
    evidence: input.evidence,
    mappingSnapshotHash: input.run.mappingVersionHash,
    rulesUsed: input.run.rulesUsed,
    engineVersion: input.run.engineVersion,
    assumptions: input.assumptions,
    warnings: input.warnings,
    approvals: input.approvals,
    reviewDecisions: input.reviewDecisions,
    validation: input.validation,
    ct600Band: input.ct600Band ?? null,
    exports: input.exports,
    selfExclusionRules: input.selfExclusionRules,
    note: 'manifest.json excludes itself and manifest.sha256 from its own export list (self-hashing is impossible). Verify the manifest hash against the exported package and the recorded external filing.',
  };

  const bytes = Buffer.from(JSON.stringify(content, null, 2), 'utf-8');
  return { manifest: content, sha256: sha256Hex(bytes) };
}
