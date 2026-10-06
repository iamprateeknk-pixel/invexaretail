// Phase 4: transfer evidence photos, extracted out of routes/core.ts (the
// "Transfers" backlog row for `POST/GET /transfers/:transferId/evidence`,
// docs/route-ownership-matrix.md). Behavior is unchanged from the inline
// handlers this replaces: same checks, same status codes, same messages. It
// keeps core.ts's exact auth chain, so mounting here cannot widen access.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { canAccessLocation, type AccessContext, type Role } from '../lib/inventory.js';
import { findTransferForCompany } from '../lib/repository.js';
import { evidenceMime, saveTransferEvidence, listTransferEvidence, readTransferEvidence } from '../lib/transfer-evidence.js';
import type { EnhancedUserRecord } from '../lib/enterprise-repository.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const INVENTORY_ROLES: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
function accessContext(user: EnhancedUserRecord): AccessContext {
  const role = INVENTORY_ROLES.includes(user.role) ? (user.role as Role) : 'STORE_USER';
  return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

router.post('/transfers/:transferId/evidence', upload.single('evidence'), async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'STORE_USER', 'WAREHOUSE_PICKER'].includes(context.role)
      || (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId))) {
    return res.status(403).json({ message: 'Transfer evidence upload access denied.' });
  }
  if (!req.file) return res.status(400).json({ message: 'Evidence file is required.' });
  try { evidenceMime(req.file.buffer); }
  catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid photo.' }); }
  try {
    const evidence = await saveTransferEvidence(transferId, req.user!.id, req.file.originalname, req.file.buffer);
    return res.status(201).json({ success: true, evidence });
  } catch {
    return res.status(503).json({ message: 'Photo was not saved. Check database storage and retry.' });
  }
});

router.get('/transfers/:transferId/evidence', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }
  try { return res.json({ evidence: await listTransferEvidence(transferId) }); }
  catch { return res.status(503).json({ message: 'Evidence storage unavailable.' }); }
});

router.get('/transfers/:transferId/evidence/:evidenceId', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }
  try {
    const evidence = await readTransferEvidence(transferId, firstParam(req.params.evidenceId));
    if (!evidence) return res.status(404).json({ message: 'Photo was not found.' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'attachment');
    return res.type(evidence.mimeType).send(Buffer.from(evidence.contents));
  } catch { return res.status(503).json({ message: 'Evidence storage unavailable.' }); }
});

export default router;
