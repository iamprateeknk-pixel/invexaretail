import { Router, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { canAccessLocation, type AccessContext, type Role } from '../lib/inventory.js';
import { listTransfers } from '../lib/repository.js';
import { DEFAULT_COMPANY_ID, ownerOfLocation } from '../lib/saas/tenant-scope.js';
import { listTransferEvidence, readTransferEvidence } from '../lib/transfer-evidence.js';
import { createSignedAccessToken, verifySignedAccessToken } from '../lib/signed-access.js';
import type { EnhancedUserRecord } from '../lib/enterprise-repository.js';

// Guide Week 18: evidence is fetched through short-lived signed links, so a
// photo can be shown in an <img>, a PDF or a support ticket without handing
// out the caller's bearer token, and a link cannot be replayed for another
// resource, another company, or after it expires.
const router = Router();
const KIND = 'transfer-evidence';
const INVENTORY_ROLES: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];

function accessContext(user: EnhancedUserRecord): AccessContext {
  const role = INVENTORY_ROLES.includes(user.role) ? (user.role as Role) : 'STORE_USER';
  return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? '');

router.post('/transfers/:transferId/evidence/:evidenceId/access-link', extractToken, requireAuth, enforcePermissionOverrides, async (req: Request, res: Response) => {
  const transferId = first(req.params.transferId);
  const evidenceId = first(req.params.evidenceId);
  const transfer = listTransfers().find((record) => record.id === transferId);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }
  try {
    const evidence = (await listTransferEvidence(transferId)).find((row: { id: string }) => row.id === evidenceId);
    if (!evidence) return res.status(404).json({ message: 'Photo was not found.' });
  } catch {
    return res.status(503).json({ message: 'Evidence storage unavailable.' });
  }
  const ttl = Number(req.body?.ttlSeconds);
  const { token, expiresAt } = createSignedAccessToken({
    kind: KIND, resource: `${transferId}/${evidenceId}`, companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    ttlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
  });
  return res.status(201).json({ url: `/api/v1/evidence-files/${token}`, expiresAt });
});

// Deliberately unauthenticated by bearer token: the signed, expiring,
// company-bound link is the credential (same model as the marketplace webhook).
router.get('/evidence-files/:token', async (req: Request, res: Response) => {
  const claims = verifySignedAccessToken(first(req.params.token));
  if (!claims || claims.kind !== KIND) return res.status(404).json({ message: 'Link is invalid or has expired.' });
  const [transferId, evidenceId] = claims.resource.split('/');
  const transfer = listTransfers().find((record) => record.id === transferId);
  // The link's company must still own the transfer it was issued for.
  const owner = transfer ? ownerOfLocation(transfer.sourceLocationId) ?? ownerOfLocation(transfer.destinationLocationId) : undefined;
  if (!transfer || (owner ?? DEFAULT_COMPANY_ID) !== claims.companyId) return res.status(404).json({ message: 'Link is invalid or has expired.' });
  try {
    const evidence = await readTransferEvidence(transferId, evidenceId);
    if (!evidence) return res.status(404).json({ message: 'Link is invalid or has expired.' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment');
    return res.type(evidence.mimeType).send(Buffer.from(evidence.contents));
  } catch {
    return res.status(503).json({ message: 'Evidence storage unavailable.' });
  }
});

export default router;
