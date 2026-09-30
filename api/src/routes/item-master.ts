import { Router, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID, companyOwnsItem } from '../lib/saas/tenant-scope.js';
import { deleteBlockers, parseStatusChange } from '../lib/item-master.js';
import { ItemMasterError, changeItemStatus, deleteItemPermanently, referenceCounts } from '../lib/item-master-service.js';
import { requireTenantContext } from '../lib/tenant-context.js';

// Blueprint v4 §6: lifecycle controls for the canonical Item Master.
// Create/edit live on POST/PUT /items in core.ts.
const router = Router();
const guard = [extractToken, requireAuth, enforcePermissionOverrides];

function companyOf(req: Request): string {
  return req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID;
}

const canMaintain = (role: string) => role === 'ADMIN' || role === 'ADMIN_USER';

function respond(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ItemMasterError) {
        res.status(error.status).json({ message: error.message, ...(error.blockers ? { blockers: error.blockers } : {}) });
        return;
      }
      console.error('Item master request failed', error);
      res.status(500).json({ message: 'Unable to complete the item request.' });
    }
  };
}

function itemIdOf(req: Request): string {
  const id = String(req.params.id ?? '');
  if (!companyOwnsItem(companyOf(req), id)) throw new ItemMasterError('Item was not found.', 404);
  return id;
}

/** Fails closed (throws) if the session has no resolvable tenant - see ADR-002. */
function tenantContextOf(req: Request) {
  return requireTenantContext({
    companyId: companyOf(req),
    userId: req.user?.id,
    role: req.user?.role,
  });
}

router.get('/items/:id/references', ...guard, respond(async (req, res) => {
  if (!canMaintain(req.user!.role) && req.user!.role !== 'AUDITOR') throw new ItemMasterError('Admin access required.', 403);
  const counts = await referenceCounts(itemIdOf(req));
  const blockers = deleteBlockers(counts);
  res.json({ counts, blockers, canDelete: blockers.length === 0 });
}));

router.patch('/items/:id/status', ...guard, respond(async (req, res) => {
  if (!canMaintain(req.user!.role)) throw new ItemMasterError('Only admins can archive or restore items.', 403);
  let change;
  try {
    change = parseStatusChange(req.body ?? {});
  } catch (error) {
    throw new ItemMasterError(error instanceof Error ? error.message : 'Invalid status change.');
  }
  const result = await changeItemStatus(tenantContextOf(req), itemIdOf(req), change);
  res.json(result);
}));

router.delete('/items/:id', ...guard, respond(async (req, res) => {
  // Hard-delete governance stays with the Main Admin (blueprint v4 §4).
  if (req.user!.role !== 'ADMIN') throw new ItemMasterError('Only the Main Admin can permanently delete an item.', 403);
  await deleteItemPermanently(tenantContextOf(req), itemIdOf(req));
  res.status(204).send();
}));

export default router;
