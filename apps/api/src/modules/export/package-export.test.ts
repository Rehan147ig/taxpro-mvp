import { describe, expect, it } from 'vitest';
import { generateWorkpaperPackage, buildPackageManifest, buildReviewItemsCsv, buildAiTracesCsv, buildSummaryText, type WorkpaperPackageInput } from './package-export.js';

const baseInput: WorkpaperPackageInput = {
  period: '2025-12-31',
  bookIncome: 500_000,
  currentTaxExpense: 100_000,
  deferredTaxExpense: 10_000,
  totalTaxExpense: 110_000,
  effectiveTaxRate: 0.22,
  statutoryRate: 0.25,
  taxPayable: 95_000,
  valuationAllowance: 0,
  createdAt: '2026-06-01T10:00:00.000Z',
  sourceHash: 'abc123hash',
  auditEntries: [
    { timestamp: '2026-06-01T10:00:00.000Z', eventType: 'provision_run.created', actor: 'user-1', description: 'Run created', metadata: { mode: 'direct' } },
  ],
  reviewItems: [
    { itemType: 'missing_depreciation_metadata', title: 'Missing depreciation metadata for 5200', severity: 'medium', status: 'open', confidenceScore: 30 },
  ],
  aiTraces: [
    { workflowName: 'mapping_agent', status: 'completed', provider: 'openai', model: 'gpt-4o', promptVersion: 'map-v3', errorMessage: null, completedAt: '2026-06-01T10:00:01.000Z' },
    { workflowName: 'mapping_agent', status: 'fallback_used', provider: null, model: null, promptVersion: 'map-v3', errorMessage: 'model unreachable', completedAt: '2026-06-01T10:00:02.000Z' },
  ],
  approvalTrail: { approvalStatus: 'approved', submittedAt: '2026-06-01T11:00:00.000Z', finalizedAt: '2026-06-01T12:00:00.000Z' },
};

function hasEntry(buf: Buffer, name: string): boolean {
  return buf.includes(Buffer.from(name, 'utf-8'));
}

describe('workpaper package', () => {
  it('contains calculation summary, audit trail, review items, AI traces, approval trail, assumptions and manifest', async () => {
    const buf = await generateWorkpaperPackage(baseInput);
    expect(hasEntry(buf, 'provision-2025-12-31.xlsx')).toBe(true);
    expect(hasEntry(buf, 'audit-trail-2025-12-31.csv')).toBe(true);
    expect(hasEntry(buf, 'review-items.csv')).toBe(true);
    expect(hasEntry(buf, 'ai-traces.csv')).toBe(true);
    expect(hasEntry(buf, 'approval-trail.json')).toBe(true);
    expect(hasEntry(buf, 'assumptions.json')).toBe(true);
    expect(hasEntry(buf, 'manifest.json')).toBe(true);
    expect(hasEntry(buf, 'package-summary.txt')).toBe(true);
  });

  it('is byte-reproducible for identical immutable run data', async () => {
    const a = await generateWorkpaperPackage(baseInput);
    const b = await generateWorkpaperPackage({ ...baseInput, auditEntries: [...baseInput.auditEntries] });
    expect(b.equals(a)).toBe(true);
  });

  it('changes when review items or AI traces change', async () => {
    const a = await generateWorkpaperPackage(baseInput);
    const b = await generateWorkpaperPackage({ ...baseInput, reviewItems: [] });
    expect(a.equals(b)).toBe(false);
  });

  it('manifests per-file sha256 including source hash', async () => {
    const files = [
      { name: 'a.txt', content: Buffer.from('hello') },
      { name: 'b.csv', content: Buffer.from('x,y\n1,2') },
    ];
    const manifest = JSON.parse(buildPackageManifest('2026-01-01T00:00:00.000Z', 'srchash', files));
    expect(manifest.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(manifest.sourceHash).toBe('srchash');
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files[0].sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(manifest.files[1].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('review-items CSV quotes titles and carries confidence scores', () => {
    const csv = buildReviewItemsCsv(baseInput.reviewItems!);
    expect(csv).toContain('item_type,title,severity,status,confidence_score');
    expect(csv).toContain('missing_depreciation_metadata');
    expect(csv).toContain('Missing depreciation metadata for 5200');
    expect(csv).toContain('medium,open,30');
  });

  it('AI traces CSV distinguishes completed vs fallback outcomes', () => {
    const csv = buildAiTracesCsv(baseInput.aiTraces!);
    expect(csv).toContain('mapping_agent,completed,openai,gpt-4o,map-v3');
    expect(csv).toContain('mapping_agent,fallback_used,,,map-v3,model unreachable');
  });

  it('summary lists source hash, review items and AI trace counts', () => {
    const text = buildSummaryText(baseInput, 8);
    expect(text).toContain('Source Hash:      abc123hash');
    expect(text).toContain('Review Items:     1');
    expect(text).toContain('AI Traces:        2');
    expect(text).toContain('deterministic build for locked runs');
  });
});
