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
import { DomainError, isDomainError, sendError, statusForErrorCode } from '../lib/errors.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { searchItems, requireItemById, getCatalogueVersion, ItemNotFoundError } from '../lib/repositories/item-repository.js';
import { getStockDetail } from '../lib/stock-detail-service.js';
import { postInventoryMovement, reverseInventoryMovement, NegativeStockBlockedError, MovementNotFoundError, AlreadyReversedError } from '../lib/inventory-posting-service.js';
import { decimalsToNumbers } from '../lib/decimal-json.js';
import { companyOwnsLocation } from '../lib/saas/tenant-scope.js';
import { prisma } from '../lib/db.js';
import { checkApprovalGate, type GateResult } from '../lib/approval-rules.js';
import { readValueAtRisk } from '../lib/exceptions.js';
import { getStudioItemCreateFields, getStudioItemFields, setStudioItemField } from '../lib/saas/studio-item-fields.js';
import { isOperationalAdmin } from './core-shared.js';

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

// Cheap change detector for the full catalogue (GET /items): the web app asks this first and refetches the
// catalogue only when the version moved. null (memory mode) means "unknown - refetch".
router.get('/items/version', async (req: Request, res: Response) => {
  return res.json({ version: await getCatalogueVersion(tenantContextFor(req)) });
});

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

router.get('/items/studio-create-fields', async (req, res) => {
  if (req.apiKey || !isOperationalAdmin(req.user!.role)) return sendError(res, 403, 'FORBIDDEN', 'Sign in as a company admin to create items.');
  res.set('Cache-Control', 'no-store');
  return res.json(await getStudioItemCreateFields(tenantContextFor(req)));
});

router.get('/items/:itemId/studio-fields', async (req, res) => {
  if (req.apiKey) return sendError(res, 403, 'FORBIDDEN', 'Sign in as a company user to view item fields.');
  try {
    return res.json(await getStudioItemFields(tenantContextFor(req), firstParam(req.params.itemId)));
  } catch (error) {
    if (error instanceof ItemNotFoundError) return sendError(res, 404, 'NOT_FOUND', error.message);
    throw error;
  }
});

router.put('/items/:itemId/studio-fields/:fieldKey', async (req, res) => {
  if (req.apiKey) return sendError(res, 403, 'FORBIDDEN', 'Sign in as a company user to edit item fields.');
  const { value, versionId } = req.body ?? {};
  if (typeof versionId !== 'string' || !versionId || versionId.length > 191 || value === undefined) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'The published version and field value are required.');
  }
  try {
    return res.json(await setStudioItemField(tenantContextFor(req), firstParam(req.params.itemId), firstParam(req.params.fieldKey), versionId, value));
  } catch (error) {
    if (error instanceof ItemNotFoundError) return sendError(res, 404, 'NOT_FOUND', error.message);
    if (isDomainError(error)) return sendError(res, statusForErrorCode(error.code), error.code, error.message);
    throw error;
  }
});

type AdjustBody = { locationId?: string; lotId?: string; qtyDelta?: number; reason?: string; idempotencyKey?: string };

class AdjustmentApprovalRequired extends DomainError {
  constructor(readonly approval: Extract<GateResult, { blocked: true }>) {
    super('CONFLICT', `${approval.reason} Submit the same adjustment again after approval.`);
  }
}

// Manual stock adjustments and reversals change on-hand quantity, so they are an
// admin action (the web wizard is already limited to these roles). Before this
// gate any authenticated role - a store user, picker or auditor - could post
// them straight to the API.
const ADJUST_ROLES = ['ADMIN', 'ADMIN_USER'];
function requireAdjustRole(req: Request, res: Response, next: () => void) {
  if (!ADJUST_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ message: 'Only an admin can post or reverse stock adjustments.', code: 'ADJUST_ROLE_DENIED' });
  }
  return next();
}

router.post('/items/:itemId/adjust', requireAdjustRole, async (req: Request, res: Response) => {
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
    const item = await requireItemById(ctx, itemId);
    if (!companyOwnsLocation(ctx.companyId, body.locationId)) {
      return res.status(404).json({ message: `Location ${body.locationId} was not found.` });
    }
    const lot = await prisma.lot.findUnique({ where: { id: body.lotId }, select: { itemId: true } });
    if (!lot || lot.itemId !== itemId) {
      return res.status(404).json({ message: `Lot ${body.lotId} was not found for this item.` });
    }

    const command = {
      tenant: ctx,
      itemId,
      lotId: body.lotId,
      locationId: body.locationId,
      movementType: 'ADJUSTMENT',
      qtyDelta: body.qtyDelta,
      reason: body.reason.trim(),
      idempotencyKey: body.idempotencyKey.trim(),
    };
    const result = await postInventoryMovement(command, async () => {
      const gate = await checkApprovalGate({
        triggerType: 'STOCK_ADJUSTMENT',
        entityType: 'StockAdjustment',
        entityId: `item-adjustment:${command.idempotencyKey}`,
        category: item.category ?? null,
        locationId: command.locationId,
        value: async () => (await readValueAtRisk(ctx, itemId, Math.abs(command.qtyDelta))) ?? 0,
        intent: [itemId, command.lotId, command.locationId, command.qtyDelta, command.reason],
        requestedById: ctx.userId,
        companyId: ctx.companyId,
      });
      if (gate.blocked) throw new AdjustmentApprovalRequired(gate);
    });
    return res.status(result.duplicate ? 200 : 201).json(decimalsToNumbers({
      duplicate: result.duplicate,
      movement: result.movement,
      balance: result.balance,
    }));
  } catch (error) {
    if (error instanceof ItemNotFoundError) return res.status(404).json({ message: error.message });
    if (error instanceof NegativeStockBlockedError) return res.status(422).json({ message: error.message, code: 'INSUFFICIENT_STOCK' });
    if (error instanceof AdjustmentApprovalRequired) {
      return sendError(res, 409, error.code, error.message, {
        approvalRequestId: error.approval.requestId, requiredApproverRole: error.approval.requiredApproverRole,
      });
    }
    if (isDomainError(error)) return res.status(statusForErrorCode(error.code)).json(error.toEnvelope());
    throw error;
  }
});

router.post('/items/:itemId/movements/:movementId/reverse', requireAdjustRole, async (req: Request, res: Response) => {
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
