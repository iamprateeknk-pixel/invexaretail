// Week 8: the first bounded-context router extracted out of the "god
// router" (routes/core.ts, 3885 lines / 93 handlers before this week).
// Thin route -> command/query service -> domain policy -> repository, per
// the guide's Week 8 scope. Only two of core.ts's 27 Transfer routes move
// here this pass (GET /transfers/list, POST /transfers) - the rest are
// tracked as backlog in docs/route-ownership-matrix.md, not silently
// dropped. Behavior is unchanged from the handlers this replaces in
// core.ts: same validation, same reservation call, same audit trail, same
// response shapes - verified by transfers.parity.test.ts running the exact
// request/response pairs the old inline handlers were covered by.
import { Router, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { isDomainError, statusForErrorCode } from '../lib/errors.js';
import type { AccessContext, Role, TransferInput } from '../lib/inventory.js';
import { listTransfersForContext } from '../lib/repositories/transfer-repository.js';
import { createTransfer, TransferRoleError, TransferValidationError, TransferExpiryBlockedError, InsufficientStockError } from '../lib/transfer-command-service.js';
import type { EnhancedUserRecord } from '../lib/enterprise-repository.js';

const router = Router();

// Identical auth chain to routes/core.ts's router (this file replaces two
// of that router's routes, so it must enforce exactly what they did - no
// new route can bypass tenant/auth/permission middleware by mounting here
// instead of there; see transfers.authz.test.ts).
router.use(extractToken, requireAuth, enforcePermissionOverrides);

// Duplicated 1:1 from core.ts's local `accessContext` helper rather than
// extracted into a shared module this week - a 3-line pure function, and
// consolidating file-local helpers that are used dozens of times elsewhere
// in core.ts is exactly the kind of larger refactor this week's extraction
// backlog (docs/route-ownership-matrix.md) defers rather than rushes.
const INVENTORY_ROLES: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
function accessContext(user: EnhancedUserRecord): AccessContext {
  const role = INVENTORY_ROLES.includes(user.role) ? (user.role as Role) : 'STORE_USER';
  return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}

router.get('/transfers/list', (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  return res.json({ transfers: listTransfersForContext(context) });
});

router.post('/transfers', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const input = req.body as TransferInput;

  try {
    const saved = await createTransfer({
      context,
      input,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      requestId: res.locals.requestId,
      traceId: res.locals.requestId,
    });
    return res.status(201).json({ success: true, transfer: saved });
  } catch (error) {
    if (error instanceof InsufficientStockError) return res.status(statusForErrorCode(error.code)).json(error.toEnvelope());
    if (isDomainError(error)) return res.status(statusForErrorCode(error.code)).json(error.toEnvelope());
    if (error instanceof TransferRoleError) return res.status(403).json({ message: error.message });
    if (error instanceof TransferValidationError || error instanceof TransferExpiryBlockedError) {
      return res.status(error instanceof TransferExpiryBlockedError ? 409 : 400).json({ message: error.message });
    }
    return res.status(403).json({ message: error instanceof Error ? error.message : 'Invalid transfer payload' });
  }
});

export default router;
