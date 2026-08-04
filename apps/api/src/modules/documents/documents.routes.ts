import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { withTenantContext } from '../../config/db.js';
import { sourceDocuments } from '../../db/schema/source-documents.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { getUser, requireRole } from '../../lib/middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { getStorage, sha256Hex, buildStorageKey } from '../../lib/storage/index.js';
import { validateDocumentType, documentMetadataSchema, DOCUMENT_TYPE_LABELS } from './document-types.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv', '.txt', '.xml'];

export const documentRoutes = new Hono();
documentRoutes.use('*', authMiddleware);

function sniffMatches(buffer: Buffer, fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const hasPrefix = (hex: string) =>
    buffer.length >= hex.length / 2 &&
    buffer.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  if (ext === '.pdf') return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  if (ext === '.xlsx') return hasPrefix('504b0304');
  if (ext === '.xls') return hasPrefix('504b0304') || hasPrefix('d0cf11e0');
  return true;
}

async function validateAndHash(file: File): Promise<{ buffer: Buffer; sha256: string; mime: string }> {
  const fileName = file.name.toLowerCase();
  const isSupported = SUPPORTED_EXTENSIONS.some(ext => fileName.endsWith(ext));
  if (!isSupported) {
    throw new BadRequestError(`Unsupported file type: ${file.name}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) throw new BadRequestError('Uploaded file is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestError(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB. Maximum upload size is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`);
  }
  if (!sniffMatches(buffer, fileName)) {
    throw new BadRequestError(`File content does not match its extension (${file.name}): rejected as a possible disguised or corrupt upload.`);
  }
  const mime = file.type || 'application/octet-stream';
  return { buffer, sha256: sha256Hex(buffer), mime };
}

async function storeDocument(tx: any, args: {
  tenantId: string;
  userId: string;
  file: File;
  documentType: string;
  entityId?: string;
  accountingPeriodId?: string;
  taxPeriodId?: string;
  provenance?: string;
  parentDocumentId?: string;
  version: number;
  docId: string;
}) {
  const { buffer, sha256, mime } = await validateAndHash(args.file);
  const storageKey = buildStorageKey({
    tenantId: args.tenantId,
    documentType: args.documentType,
    docId: args.docId,
    version: args.version,
    filename: args.file.name,
  });
  await getStorage().put(storageKey, buffer);
  const [row] = await tx.insert(sourceDocuments).values({
    id: args.docId,
    tenantId: args.tenantId,
    entityId: args.entityId ?? null,
    accountingPeriodId: args.accountingPeriodId ?? null,
    taxPeriodId: args.taxPeriodId ?? null,
    documentType: args.documentType,
    filename: args.file.name,
    mimeType: mime,
    sizeBytes: buffer.length,
    storageKey,
    sha256,
    provenance: args.provenance ?? 'manual_upload',
    version: args.version,
    parentDocumentId: args.parentDocumentId ?? null,
    isCurrent: true,
    uploadedByUserId: args.userId,
  }).returning();
  return row;
}

// ── Upload a new artefact (creates version 1) ──
documentRoutes.post('/', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('form', documentMetadataSchema), async (c) => {
    const user = getUser(c);
    const meta = c.req.valid('form');
    const documentType = validateDocumentType(meta.documentType);

    const contentType = c.req.header('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
      throw new BadRequestError('Expected multipart/form-data upload');
    }
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) throw new BadRequestError('No file uploaded. Use field name "file".');

    return withTenantContext(user.tenantId, async (tx) => {
      const row = await storeDocument(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        file,
        documentType,
        entityId: meta.entityId,
        accountingPeriodId: meta.accountingPeriodId,
        taxPeriodId: meta.taxPeriodId,
        provenance: meta.provenance,
        version: 1,
        docId: randomUUID(),
      });
      return c.json(row, 201);
    });
  });

// ── List artefacts (metadata only) ──
documentRoutes.get('/', async (c) => {
  const user = getUser(c);
  const entityId = c.req.query('entityId');
  const documentType = c.req.query('documentType');
  return withTenantContext(user.tenantId, async (tx) => {
    const conditions = [eq(sourceDocuments.tenantId, user.tenantId)];
    if (entityId) conditions.push(eq(sourceDocuments.entityId, entityId));
    if (documentType) conditions.push(eq(sourceDocuments.documentType, documentType));
    const rows = await tx.select().from(sourceDocuments)
      .where(and(...conditions))
      .orderBy(desc(sourceDocuments.createdAt));
    return c.json(rows.map((r) => ({ ...r, typeLabel: DOCUMENT_TYPE_LABELS[r.documentType] ?? r.documentType })));
  });
});

// ── Metadata for one artefact ──
documentRoutes.get('/:id', async (c) => {
  const user = getUser(c);
  return withTenantContext(user.tenantId, async (tx) => {
    const [row] = await tx.select().from(sourceDocuments)
      .where(and(eq(sourceDocuments.id, c.req.param('id')), eq(sourceDocuments.tenantId, user.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundError('Source document', c.req.param('id'));
    return c.json({ ...row, typeLabel: DOCUMENT_TYPE_LABELS[row.documentType] ?? row.documentType });
  });
});

// ── Replace an artefact (creates a new version; originals are immutable) ──
documentRoutes.post('/:id/replace', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('form', z.object({ entityId: z.string().uuid().optional() })), async (c) => {
    const user = getUser(c);
    const contentType = c.req.header('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
      throw new BadRequestError('Expected multipart/form-data upload');
    }
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) throw new BadRequestError('No file uploaded. Use field name "file".');

    return withTenantContext(user.tenantId, async (tx) => {
      const [current] = await tx.select().from(sourceDocuments)
        .where(and(eq(sourceDocuments.id, c.req.param('id')), eq(sourceDocuments.tenantId, user.tenantId)))
        .limit(1);
      if (!current) throw new NotFoundError('Source document', c.req.param('id'));

      const nextVersion = current.version + 1;
      const newId = randomUUID();
      const row = await storeDocument(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        file,
        documentType: current.documentType,
        entityId: current.entityId ?? undefined,
        accountingPeriodId: current.accountingPeriodId ?? undefined,
        taxPeriodId: current.taxPeriodId ?? undefined,
        provenance: current.provenance,
        parentDocumentId: current.id,
        version: nextVersion,
        docId: newId,
      });

      // Original metadata row is never mutated; the old version keeps its
      // bytes and hash forever, marked as superseded.
      await tx.update(sourceDocuments)
        .set({ isCurrent: false })
        .where(eq(sourceDocuments.id, current.id));

      return c.json({ previous: { id: current.id, version: current.version, sha256: current.sha256 }, current: row }, 201);
    });
  });

// ── Download (tenant-scoped metadata resolution happens before any storage read) ──
documentRoutes.get('/:id/download', async (c) => {
  const user = getUser(c);
  return withTenantContext(user.tenantId, async (tx) => {
    const [row] = await tx.select().from(sourceDocuments)
      .where(and(eq(sourceDocuments.id, c.req.param('id')), eq(sourceDocuments.tenantId, user.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundError('Source document', c.req.param('id'));

    const data = await getStorage().get(row.storageKey);
    c.header('Content-Type', row.mimeType);
    c.header('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`);
    c.header('X-Document-Sha256', row.sha256);
    return c.body(data as any);
  });
});
