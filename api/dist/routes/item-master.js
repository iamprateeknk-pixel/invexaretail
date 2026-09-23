"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const item_master_js_1 = require("../lib/item-master.js");
const item_master_service_js_1 = require("../lib/item-master-service.js");
const tenant_context_js_1 = require("../lib/tenant-context.js");
// Blueprint v4 §6: lifecycle controls for the canonical Item Master.
// Create/edit live on POST/PUT /items in core.ts.
const router = (0, express_1.Router)();
const guard = [enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth];
function companyOf(req) {
    return req.companyId ?? req.user.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID;
}
const canMaintain = (role) => role === 'ADMIN' || role === 'ADMIN_USER';
function respond(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        }
        catch (error) {
            if (error instanceof item_master_service_js_1.ItemMasterError) {
                res.status(error.status).json({ message: error.message, ...(error.blockers ? { blockers: error.blockers } : {}) });
                return;
            }
            console.error('Item master request failed', error);
            res.status(500).json({ message: 'Unable to complete the item request.' });
        }
    };
}
function itemIdOf(req) {
    const id = String(req.params.id ?? '');
    if (!(0, tenant_scope_js_1.companyOwnsItem)(companyOf(req), id))
        throw new item_master_service_js_1.ItemMasterError('Item was not found.', 404);
    return id;
}
/** Fails closed (throws) if the session has no resolvable tenant - see ADR-002. */
function tenantContextOf(req) {
    return (0, tenant_context_js_1.requireTenantContext)({
        companyId: companyOf(req),
        userId: req.user?.id,
        role: req.user?.role,
    });
}
router.get('/items/:id/references', ...guard, respond(async (req, res) => {
    if (!canMaintain(req.user.role) && req.user.role !== 'AUDITOR')
        throw new item_master_service_js_1.ItemMasterError('Admin access required.', 403);
    const counts = await (0, item_master_service_js_1.referenceCounts)(itemIdOf(req));
    const blockers = (0, item_master_js_1.deleteBlockers)(counts);
    res.json({ counts, blockers, canDelete: blockers.length === 0 });
}));
router.patch('/items/:id/status', ...guard, respond(async (req, res) => {
    if (!canMaintain(req.user.role))
        throw new item_master_service_js_1.ItemMasterError('Only admins can archive or restore items.', 403);
    let change;
    try {
        change = (0, item_master_js_1.parseStatusChange)(req.body ?? {});
    }
    catch (error) {
        throw new item_master_service_js_1.ItemMasterError(error instanceof Error ? error.message : 'Invalid status change.');
    }
    const result = await (0, item_master_service_js_1.changeItemStatus)(tenantContextOf(req), itemIdOf(req), change);
    res.json(result);
}));
router.delete('/items/:id', ...guard, respond(async (req, res) => {
    // Hard-delete governance stays with the Main Admin (blueprint v4 §4).
    if (req.user.role !== 'ADMIN')
        throw new item_master_service_js_1.ItemMasterError('Only the Main Admin can permanently delete an item.', 403);
    await (0, item_master_service_js_1.deleteItemPermanently)(tenantContextOf(req), itemIdOf(req));
    res.status(204).send();
}));
exports.default = router;
