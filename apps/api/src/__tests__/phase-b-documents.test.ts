import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalStorageBackend, sha256Hex, buildStorageKey } from '../lib/storage/index.js';
import { validateDocumentType, isDocumentType, DOCUMENT_TYPES } from '../modules/documents/document-types.js';

describe('Phase B — storage interface and document artefact metadata', () => {

  it('sha256 is hex-encoded and deterministic', () => {
    const a = Buffer.from('demo trial balance');
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(a)).toBe(sha256Hex(a));
    expect(sha256Hex(Buffer.from('other'))).not.toBe(sha256Hex(a));
  });

  it('storage keys are tenant-scoped and versioned', () => {
    const key = buildStorageKey({ tenantId: 't1', documentType: 'trial_balance', docId: 'd1', version: 2, filename: 'TB 2026.xlsx' });
    expect(key).toMatch(/^t1\/trial_balance\/d1-v2-/);
    expect(key).not.toContain(' ');
  });

  it('local backend stores, reads and deletes bytes (no cloud credentials needed)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taxpro-storage-'));
    const backend = new LocalStorageBackend(dir);
    try {
      await backend.put('t1/tb/sample.csv', Buffer.from('acct,balance\n4000,-100\n'));
      expect(await backend.exists('t1/tb/sample.csv')).toBe(true);
      const out = await backend.get('t1/tb/sample.csv');
      expect(out.toString()).toContain('4000');
      await backend.delete('t1/tb/sample.csv');
      expect(await backend.exists('t1/tb/sample.csv')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('local backend rejects path traversal keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taxpro-storage-'));
    const backend = new LocalStorageBackend(dir);
    try {
      await expect(backend.put('../escape.txt', Buffer.from('x'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('document type validation accepts the controlled taxonomy only', () => {
    expect(isDocumentType('trial_balance')).toBe(true);
    expect(validateDocumentType('prior_year_tax_computation')).toBe('prior_year_tax_computation');
    expect(() => validateDocumentType('payslip')).toThrow(/Unsupported document type 'payslip'/);
    expect(() => validateDocumentType('')).toThrow(/Unsupported document type/);
    for (const t of DOCUMENT_TYPES) {
      expect(validateDocumentType(t)).toBe(t);
    }
  });
});
