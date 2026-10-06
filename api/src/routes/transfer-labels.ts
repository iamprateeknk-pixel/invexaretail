// Phase 8: transfer label and reprint-audit routes, extracted from routes/core.ts
// (docs/route-ownership-matrix.md "Transfers" backlog). Same auth chain as core.
//
// One deliberate behaviour change: the reprint-audit routes were not
// company-scoped. `GET /transfers/reprint-audit/all` returned every company's
// print log, and `GET /transfers/:id/reprint-audit` confirmed that another
// company's transfer existed and returned its log. Both now only see
// transfers the caller's company owns (404 otherwise, never 403).
import { Router, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { canAccessLocation, type AccessContext, type Role } from '../lib/inventory.js';
import { findTransferForCompany, listItems, listLocations } from '../lib/repository.js';
import { generateThermalTransferLabel, getReprintAudit, recordReprint } from '../lib/thermal-pdf.js';
import { persistAudit } from '../lib/persistence.js';
import { recordAudit } from '../lib/audit.js';
import type { EnhancedUserRecord } from '../lib/enterprise-repository.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides);

const INVENTORY_ROLES: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
function accessContext(user: EnhancedUserRecord): AccessContext {
  const role = INVENTORY_ROLES.includes(user.role) ? (user.role as Role) : 'STORE_USER';
  return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}

const isOperationalAdmin = (role: string) => role === 'ADMIN' || role === 'ADMIN_USER';
const companyOf = (req: Request) => req.companyId ?? DEFAULT_COMPANY_ID;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

router.get('/transfers/reprint-audit/all', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can view reprint audit.' });
  }
  const companyId = companyOf(req);
  const auditLog = getReprintAudit().filter((entry) => findTransferForCompany(entry.transferId, companyId));
  return res.json({ auditLog, totalEntries: auditLog.length });
});

router.get('/transfers/:transferId/reprint-audit', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can view reprint audit.' });
  }
  const transferId = firstParam(req.params.transferId);
  if (!findTransferForCompany(transferId, companyOf(req))) {
    return res.status(404).json({ message: 'Transfer not found.' });
  }
  return res.json({ transferId, auditLog: getReprintAudit(transferId) });
});

router.get('/transfers/:transferId/label', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, companyOf(req));
  if (!transfer) {
    return res.status(404).json({ message: 'Transfer not found.' });
  }

  const context = accessContext(req.user!);
  if (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }

  const html = generateThermalTransferLabel({
    transfer,
    itemNames: new Map(listItems().map((item) => [item.id, item.name])),
    locationNames: new Map(listLocations().map((location) => [location.id, location.name])),
    printedBy: req.user!.name ?? req.user!.email,
    printTime: new Date().toISOString(),
  });

  recordReprint({ transferId, printedBy: req.user!.id, printTime: new Date().toISOString() });
  await persistAudit(recordAudit({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'TRANSFER_LABEL_PRINTED',
    entityType: 'Transfer',
    entityId: transferId,
  }));

  return res.type('text/html').status(200).send(html);
});

export default router;
