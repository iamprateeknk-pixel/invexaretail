// Week 10: the Item Search / Stock Detail / Adjustment-Reversal vertical
// slice's backend. Thin routes -> lib services -> tenant-scoped
// repositories, continuing Week 8's extraction pattern
// (routes/transfers.ts, routes/branches.ts). Additive: `GET /items` on
// core.ts is untouched (existing consumers keep working); this file adds
// the paginated/canonical-read-model surface the guide's scope names.
import { type Request, type Response, Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import { isDomainError, statusForErrorCode } from '../lib/errors.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { searchItems, assertItemOwnedByTenant, ItemNotFoundError } from '../lib/repositories/item-repository.js';
import { getStockDetail } from '../lib/stock-detail-service.js';
import { postInventoryMovement, reverseInventoryMovement, NegativeStockBlockedError, MovementNotFoundError, AlreadyReversedError } from '../lib/inventory-posting-service.js';
import { companyOwnsLocation } from '../lib/saas/tenant-scope.js';
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

router.get('/items/search', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    return res.status(400).json({ message: 'limit must be a positive number.' });
  }
  const page = await searchItems(ctx, {
    search: typeof req.query.q === 'string' ? req.query.q : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    limit,
  });
  return res.json(page);
});

router.get('/items/:itemId/stock-detail', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  try {
    const detail = await getStockDetail(ctx, firstParam(req.params.itemId));
    return res.json(detail);
  } catch (error) {
    if (error instanceof ItemNotFoundError) return res.status(404).json({ message: error.message });
    throw error;
  }
});

type AdjustBody = { locationId?: string; lotId?: string; qtyDelta?: number; reason?: string; idempotencyKey?: string };

router.post('/items/:itemId/adjust', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  const itemId = firstParam(req.params.itemId);
  const body = req.body as AdjustBody;

  if (!body.locationId || !body.lotId || typeof body.qtyDelta !== 'number' || !Number.isFinite(body.qtyDelta) || body.qtyDelta === 0) {
    return res.status(400).json({ message: 'locationId, lotId and a non-zero numeric qtyDelta are required.' });
  }
  if (!body.reason || !body.reason.trim()) {
    return res.status(400).json({ message: 'A reason is required for a manual adjustment.' });
  }
  // Week 10 mandatory verification: "Adjustment posts once" - the wizard is
  // required to send its own idempotency key so a retried request (client
  // timeout, double-click) is provably a replay, not a guess based on
  // matching field values.
  if (!body.idempotencyKey || !body.idempotencyKey.trim()) {
    return res.status(400).json({ message: 'idempotencyKey is required so a retried request cannot post twice.' });
  }

  try {
    // Tenant isolation: postInventoryMovement itself does not verify that
    // the caller's tenant actually owns itemId/lotId/locationId - it trusts
    // its caller to have checked, the same discipline every other caller of
    // it in this codebase already follows. This is the one place a client
    // can name arbitrary ids in the request body, so it is the one place
    // that check must happen before posting, not after.
    await assertItemOwnedByTenant(ctx, itemId);
    if (!companyOwnsLocation(ctx.companyId, body.locationId)) {
      return res.status(404).json({ message: `Location ${body.locationId} was not found.` });
    }
    const lot = await prisma.lot.findUnique({ where: { id: body.lotId }, select: { itemId: true } });
    if (!lot || lot.itemId !== itemId) {
      return res.status(404).json({ message: `Lot ${body.lotId} was not found for this item.` });
    }

    const result = await postInventoryMovement({
      tenant: ctx,
      itemId,
      lotId: body.lotId,
      locationId: body.locationId,
      movementType: 'ADJUSTMENT',
      qtyDelta: body.qtyDelta,
      reason: body.reason.trim(),
      idempotencyKey: body.idempotencyKey.trim(),
    });
    return res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      movement: result.movement,
      balance: result.balance,
    });
  } catch (error) {
    if (error instanceof ItemNotFoundError) return res.status(404).json({ message: error.message });
    if (error instanceof NegativeStockBlockedError) return res.status(422).json({ message: error.message, code: 'INSUFFICIENT_STOCK' });
    if (isDomainError(error)) return res.status(statusForErrorCode(error.code)).json(error.toEnvelope());
    throw error;
  }
});

router.post('/items/:itemId/movements/:movementId/reverse', async (req: Request, res: Response) => {
  const ctx = tenantContextFor(req);
  const movementId = firstParam(req.params.movementId);
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Manual reversal';

  try {
    const result = await reverseInventoryMovement(ctx, movementId, reason);
    return res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      movement: result.movement,
      balance: result.balance,
    });
  } catch (error) {
    if (error instanceof MovementNotFoundError) return res.status(404).json({ message: error.message });
    if (error instanceof AlreadyReversedError) return res.status(409).json({ message: error.message });
    if (isDomainError(error)) return res.status(statusForErrorCode(error.code)).json(error.toEnvelope());
    throw error;
  }
});

export default router;
