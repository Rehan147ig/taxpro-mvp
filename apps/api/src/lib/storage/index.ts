import { createHash } from 'crypto';
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { resolve, dirname } from 'path';
import { env } from '../../config/env.js';

/**
 * Storage backend interface for source-document artefacts.
 *
 * Only metadata lives in Postgres; document bytes live behind this
 * interface. The default backend is local disk (works with no cloud
 * credentials); object storage can be added later behind the same
 * interface (e.g. S3/GCS with the storage key as the object key).
 */
export interface StorageBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class LocalStorageBackend implements StorageBackend {
  constructor(private readonly baseDir: string) {}

  private pathFor(key: string): string {
    if (key.includes('..') || key.includes(':') || key.includes('\\')) {
      throw new Error(`Storage key contains invalid path segments: ${key}`);
    }
    return resolve(this.baseDir, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}

let cachedBackend: StorageBackend | null = null;

/**
 * Storage keys are always tenant-scoped by construction
 * (`{tenantId}/{...}`), and every download route resolves the document
 * metadata row under RLS first, so a storage key can never be read across
 * tenants even if an object store were misconfigured.
 */
export function getStorage(): StorageBackend {
  if (cachedBackend) return cachedBackend;
  if (env.TAXPRO_STORAGE_BACKEND === 'local') {
    cachedBackend = new LocalStorageBackend(env.TAXPRO_STORAGE_DIR);
    return cachedBackend;
  }
  throw new Error(`Unsupported TAXPRO_STORAGE_BACKEND: ${env.TAXPRO_STORAGE_BACKEND}`);
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Build a tenant-scoped, versioned storage key for a document. */
export function buildStorageKey(args: {
  tenantId: string;
  documentType: string;
  docId: string;
  version: number;
  filename: string;
}): string {
  const safeName = args.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `${args.tenantId}/${args.documentType}/${args.docId}-v${args.version}-${safeName}`;
}
