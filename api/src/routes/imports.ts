// Week 11: the staged import lifecycle's HTTP surface - thin routes over
// lib/import-commit-service.ts, continuing the Week 8/10 extraction
// pattern. Commit is fire-and-forget from the request's point of view: it
// queues the batch and returns immediately - lib/import-worker.ts's
// background poll loop (or, in tests, commitImportBatchToCompletion)
// does the actual posting, so a 5,000+ row file never holds an HTTP
// request open.
import { type Request, type Response, Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { computeFileChecksum } from '../lib/import-checksum.js';
import {
  createImportBatch,
  validateImportBatch,
  queueImportBatchForCommit,
  reverseImportBatch,
  exportFailedRows,
  DuplicateFileError,
  BatchNotFoundError,
  InvalidBatchStateError,
  type ImportType,
} from '../lib/import-commit-service.js';
import type { RawImportRow } from '../lib/import-row-validation.js';
import { drainImportCommitsOnce } from '../lib/import-worker.js';
import { prisma } from '../lib/db.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides);

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

function tenantContextFor(req: Request): TenantContext {
  return {
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    tenantId: DEFAULT_TENANT_ID,
    userId: req.user!.id,
    role: req.user!.role as TenantContext['role'],
  };
}

const IMPORT_TYPES = new Set<ImportType>(['PURCHASE', 'SALES', 'SALES_RETURN', 'OPENING_STOCK']);

router.post('/imports/staged/batches', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  const { type, fileName, sourceFormat, rows } = req.body as { type?: string; fileName?: string; sourceFormat?: string; rows?: RawImportRow[] };

  if (!type || !IMPORT_TYPES.has(type as ImportType)) {
    return res.status(400).json({ message: `type must be one of ${[...IMPORT_TYPES].join(', ')}.` });
  }
  if (!fileName || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'fileName and a non-empty rows array are required.' });
  }

  const checksum = computeFileChecksum(JSON.stringify(rows));
  try {
    const batch = await createImportBatch(ctx, {
      type: type as ImportType,
      fileName,
      sourceFormat: sourceFormat ?? 'json',
      fileChecksum: checksum,
      rows,
      importedById: ctx.userId,
    });
    return res.status(201).json({ batch, duplicate: false });
  } catch (error) {
    if (error instanceof DuplicateFileError) {
      const existing = await prisma.importBatch.findUnique({ where: { id: error.existingBatchId } });
      return res.status(200).json({ batch: existing, duplicate: true });
    }
    throw error;
  }
});

router.post('/imports/staged/batches/:id/validate', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  try {
    const summary = await validateImportBatch(ctx, firstParam(req.params.id));
    return res.json(summary);
  } catch (error) {
    if (error instanceof BatchNotFoundError) return res.status(404).json({ message: error.message });
    if (error instanceof InvalidBatchStateError) return res.status(409).json({ message: error.message });
    throw error;
  }
});

router.post('/imports/staged/batches/:id/commit', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  const batchId = firstParam(req.params.id);
  try {
    await queueImportBatchForCommit(ctx, batchId);
  } catch (error) {
    if (error instanceof BatchNotFoundError) return res.status(404).json({ message: error.message });
    if (error instanceof InvalidBatchStateError) return res.status(409).json({ message: error.message });
    throw error;
  }
  // Kick the worker immediately rather than waiting for its next poll tick
  // - the request still returns right away, this just avoids an idle wait
  // in the common case where the worker's poll interval hasn't elapsed yet.
  void drainImportCommitsOnce().catch((error) => console.error('[imports] immediate drain failed', error));
  return res.status(202).json({ queued: true });
});

router.get('/imports/staged/batches/:id', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  const batch = await prisma.importBatch.findFirst({ where: { id: firstParam(req.params.id), companyId: ctx.companyId } });
  if (!batch) return res.status(404).json({ message: 'Import batch was not found.' });
  return res.json({ batch });
});

router.get('/imports/staged/batches/:id/failures', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  try {
    const rows = await exportFailedRows(ctx, firstParam(req.params.id));
    return res.json({ rows });
  } catch (error) {
    if (error instanceof BatchNotFoundError) return res.status(404).json({ message: error.message });
    throw error;
  }
});

router.post('/imports/staged/batches/:id/reverse', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Manual import reversal';
  try {
    await reverseImportBatch(ctx, firstParam(req.params.id), reason);
    return res.json({ reversed: true });
  } catch (error) {
    if (error instanceof BatchNotFoundError) return res.status(404).json({ message: error.message });
    if (error instanceof InvalidBatchStateError) return res.status(409).json({ message: error.message });
    throw error;
  }
});

export default router;
