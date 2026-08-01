import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import zlib from 'zlib';
import { generateWorkpaperPackage, buildPackageManifest, buildReviewItemsCsv, buildAiTracesCsv, buildSummaryText, PACKAGE_SCHEMA_VERSION, type WorkpaperPackageInput } from './package-export.js';

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
  mappingVersionHash: 'map-hash-1',
  engineVersion: 'tax-engine-1.2.3',
  mode: 'direct',
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

interface ZipEntryInfo {
  name: string;
  method: number;
  compSize: number;
  offset: number;
}

function readZipEntries(buf: Buffer): ZipEntryInfo[] {
  const eocd = buf.indexOf(Buffer.from('PK\x05\x06'));
  if (eocd === -1) throw new Error('EOCD not found');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const entries: ZipEntryInfo[] = [];
  let off = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central dir signature');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf-8');
    entries.push({ name, method, compSize, offset: localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryContent(buf: Buffer, info: ZipEntryInfo): Buffer {
  const lo = info.offset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('bad local header');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + info.compSize);
  return info.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
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

  it('remains byte-identical across wall-clock gaps (no volatile timestamps)', async () => {
    const a = await generateWorkpaperPackage(baseInput);
    await new Promise((r) => setTimeout(r, 60));
    const b = await generateWorkpaperPackage({ ...baseInput });
    expect(b.equals(a)).toBe(true);
  });

  it('changes when review items or AI traces change', async () => {
    const a = await generateWorkpaperPackage(baseInput);
    const b = await generateWorkpaperPackage({ ...baseInput, reviewItems: [] });
    expect(a.equals(b)).toBe(false);
  });

  it('manifest: schema version, provenance, file count, and hashes of every content file', async () => {
    const buf = await generateWorkpaperPackage(baseInput);
    const entries = readZipEntries(buf);
    const manifestEntry = entries.find(e => e.name === 'manifest.json');
    expect(manifestEntry).toBeDefined();
    const manifest = JSON.parse(readEntryContent(buf, manifestEntry!).toString('utf-8'));

    expect(manifest.schemaVersion).toBe(PACKAGE_SCHEMA_VERSION);
    expect(manifest.generatedAt).toBe('2026-06-01T10:00:00.000Z');
    expect(manifest.period).toBe('2025-12-31');
    expect(manifest.sourceHash).toBe('abc123hash');
    expect(manifest.mappingVersionHash).toBe('map-hash-1');
    expect(manifest.engineVersion).toBe('tax-engine-1.2.3');
    expect(manifest.mode).toBe('direct');

    const contentNames = entries.filter(e => e.name !== 'manifest.json').map(e => e.name);
    expect(manifest.fileCount).toBe(contentNames.length);
    expect(manifest.files).toHaveLength(contentNames.length);

    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      const entry = entries.find(e => e.name === f.name);
      expect(entry, `manifest lists ${f.name} which exists in the archive`).toBeDefined();
      const content = readEntryContent(buf, entry!);
      expect(f.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    }
  });

  it('manifest excludes itself explicitly (no self-referential hash) and documents it', async () => {
    const buf = await generateWorkpaperPackage(baseInput);
    const entries = readZipEntries(buf);
    const manifestEntry = entries.find(e => e.name === 'manifest.json');
    const manifest = JSON.parse(readEntryContent(buf, manifestEntry!).toString('utf-8'));
    expect(manifest.files.map((f: { name: string }) => f.name)).not.toContain('manifest.json');
    expect(manifest.note).toMatch(/excludes itself/i);
  });

  it('approval trail JSON preserves approval status, timestamps, source and mapping hashes', async () => {
    const buf = await generateWorkpaperPackage(baseInput);
    const entries = readZipEntries(buf);
    const entry = entries.find(e => e.name === 'approval-trail.json')!;
    const trail = JSON.parse(readEntryContent(buf, entry).toString('utf-8'));
    expect(trail).toMatchObject({
      period: '2025-12-31',
      approvalStatus: 'approved',
      submittedAt: '2026-06-01T11:00:00.000Z',
      finalizedAt: '2026-06-01T12:00:00.000Z',
      sourceHash: 'abc123hash',
      mappingVersionHash: 'map-hash-1',
    });
  });

  it('assumptions JSON carries statutory rate, engine version, mode and metadata gap count', async () => {
    const buf = await generateWorkpaperPackage(baseInput);
    const entries = readZipEntries(buf);
    const entry = entries.find(e => e.name === 'assumptions.json')!;
    const assumptions = JSON.parse(readEntryContent(buf, entry).toString('utf-8'));
    expect(assumptions.statutoryRate).toBe(0.25);
    expect(assumptions.valuationAllowance).toBe(0);
    expect(assumptions.engineVersion).toBe('tax-engine-1.2.3');
    expect(assumptions.mode).toBe('direct');
    expect(assumptions.missingDepreciationMetadataItems).toBe(1);
  });

  it('manifest with explicit file list (unit level)', async () => {
    const files = [
      { name: 'a.txt', content: Buffer.from('hello') },
      { name: 'b.csv', content: Buffer.from('x,y\n1,2') },
    ];
    const manifest = JSON.parse(buildPackageManifest({ createdAt: '2026-01-01T00:00:00.000Z', sourceHash: 'srchash', mappingVersionHash: null, engineVersion: null, mode: null, period: '2025-12-31' }, files));
    expect(manifest.schemaVersion).toBe(PACKAGE_SCHEMA_VERSION);
    expect(manifest.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(manifest.period).toBe('2025-12-31');
    expect(manifest.sourceHash).toBe('srchash');
    expect(manifest.fileCount).toBe(2);
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
