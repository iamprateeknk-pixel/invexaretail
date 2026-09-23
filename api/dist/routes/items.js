"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Week 10: the Item Search / Stock Detail / Adjustment-Reversal vertical
// slice's backend. Thin routes -> lib services -> tenant-scoped
// repositories, continuing Week 8's extraction pattern
// (routes/transfers.ts, routes/branches.ts). Additive: `GET /items` on
// core.ts is untouched (existing consumers keep working); this file adds
// the paginated/canonical-read-model surface the guide's scope names.
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const access_control_js_1 = require("../lib/access-control.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const errors_js_1 = require("../lib/errors.js");
const item_repository_js_1 = require("../lib/repositories/item-repository.js");
const stock_detail_service_js_1 = require("../lib/stock-detail-service.js");
const inventory_posting_service_js_1 = require("../lib/inventory-posting-service.js");
const tenant_scope_js_2 = require("../lib/saas/tenant-scope.js");
const db_js_1 = require("../lib/db.js");
const router = (0, express_1.Router)();
router.use(enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, access_control_js_1.enforcePermissionOverrides);
function firstParam(value) {
    return Array.isArray(value) ? value[0] : (value ?? '');
}
function tenantContextFor(req) {
    return {
        companyId: req.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
        tenantId: tenant_scope_js_1.DEFAULT_TENANT_ID,
        userId: req.user.id,
        role: req.user.role,
    };
}
router.get('/items/search', async (req, res) => {
    const ctx = tenantContextFor(req);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        return res.status(400).json({ message: 'limit must be a positive number.' });
    }
    const page = await (0, item_repository_js_1.searchItems)(ctx, {
        search: typeof req.query.q === 'string' ? req.query.q : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        limit,
    });
    return res.json(page);
});
router.get('/items/:itemId/stock-detail', async (req, res) => {
    const ctx = tenantContextFor(req);
    try {
        const detail = await (0, stock_detail_service_js_1.getStockDetail)(ctx, firstParam(req.params.itemId));
        return res.json(detail);
    }
    catch (error) {
        if (error instanceof item_repository_js_1.ItemNotFoundError)
            return res.status(404).json({ message: error.message });
        throw error;
    }
});
router.post('/items/:itemId/adjust', async (req, res) => {
    const ctx = tenantContextFor(req);
    const itemId = firstParam(req.params.itemId);
    const body = req.body;
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
        await (0, item_repository_js_1.assertItemOwnedByTenant)(ctx, itemId);
        if (!(0, tenant_scope_js_2.companyOwnsLocation)(ctx.companyId, body.locationId)) {
            return res.status(404).json({ message: `Location ${body.locationId} was not found.` });
        }
        const lot = await db_js_1.prisma.lot.findUnique({ where: { id: body.lotId }, select: { itemId: true } });
        if (!lot || lot.itemId !== itemId) {
            return res.status(404).json({ message: `Lot ${body.lotId} was not found for this item.` });
        }
        const result = await (0, inventory_posting_service_js_1.postInventoryMovement)({
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
    }
    catch (error) {
        if (error instanceof item_repository_js_1.ItemNotFoundError)
            return res.status(404).json({ message: error.message });
        if (error instanceof inventory_posting_service_js_1.NegativeStockBlockedError)
            return res.status(422).json({ message: error.message, code: 'INSUFFICIENT_STOCK' });
        if ((0, errors_js_1.isDomainError)(error))
            return res.status((0, errors_js_1.statusForErrorCode)(error.code)).json(error.toEnvelope());
        throw error;
    }
});
router.post('/items/:itemId/movements/:movementId/reverse', async (req, res) => {
    const ctx = tenantContextFor(req);
    const movementId = firstParam(req.params.movementId);
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Manual reversal';
    try {
        const result = await (0, inventory_posting_service_js_1.reverseInventoryMovement)(ctx, movementId, reason);
        return res.status(result.duplicate ? 200 : 201).json({
            duplicate: result.duplicate,
            movement: result.movement,
            balance: result.balance,
        });
    }
    catch (error) {
        if (error instanceof inventory_posting_service_js_1.MovementNotFoundError)
            return res.status(404).json({ message: error.message });
        if (error instanceof inventory_posting_service_js_1.AlreadyReversedError)
            return res.status(409).json({ message: error.message });
        if ((0, errors_js_1.isDomainError)(error))
            return res.status((0, errors_js_1.statusForErrorCode)(error.code)).json(error.toEnvelope());
        throw error;
    }
});
exports.default = router;
