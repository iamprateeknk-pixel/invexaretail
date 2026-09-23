"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const access_control_js_1 = require("../lib/access-control.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const errors_js_1 = require("../lib/errors.js");
const transfer_repository_js_1 = require("../lib/repositories/transfer-repository.js");
const transfer_command_service_js_1 = require("../lib/transfer-command-service.js");
const router = (0, express_1.Router)();
// Identical auth chain to routes/core.ts's router (this file replaces two
// of that router's routes, so it must enforce exactly what they did - no
// new route can bypass tenant/auth/permission middleware by mounting here
// instead of there; see transfers.authz.test.ts).
router.use(enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, access_control_js_1.enforcePermissionOverrides);
// Duplicated 1:1 from core.ts's local `accessContext` helper rather than
// extracted into a shared module this week - a 3-line pure function, and
// consolidating file-local helpers that are used dozens of times elsewhere
// in core.ts is exactly the kind of larger refactor this week's extraction
// backlog (docs/route-ownership-matrix.md) defers rather than rushes.
const INVENTORY_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
function accessContext(user) {
    const role = INVENTORY_ROLES.includes(user.role) ? user.role : 'STORE_USER';
    return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}
router.get('/transfers/list', (req, res) => {
    const context = accessContext(req.user);
    return res.json({ transfers: (0, transfer_repository_js_1.listTransfersForContext)(context) });
});
router.post('/transfers', async (req, res) => {
    const context = accessContext(req.user);
    const input = req.body;
    try {
        const saved = await (0, transfer_command_service_js_1.createTransfer)({
            context,
            input,
            actorId: req.user.id,
            actorRole: req.user.role,
            companyId: req.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
            requestId: res.locals.requestId,
            traceId: res.locals.requestId,
        });
        return res.status(201).json({ success: true, transfer: saved });
    }
    catch (error) {
        if (error instanceof transfer_command_service_js_1.InsufficientStockError)
            return res.status((0, errors_js_1.statusForErrorCode)(error.code)).json(error.toEnvelope());
        if ((0, errors_js_1.isDomainError)(error))
            return res.status((0, errors_js_1.statusForErrorCode)(error.code)).json(error.toEnvelope());
        if (error instanceof transfer_command_service_js_1.TransferRoleError)
            return res.status(403).json({ message: error.message });
        if (error instanceof transfer_command_service_js_1.TransferValidationError || error instanceof transfer_command_service_js_1.TransferExpiryBlockedError) {
            return res.status(error instanceof transfer_command_service_js_1.TransferExpiryBlockedError ? 409 : 400).json({ message: error.message });
        }
        return res.status(403).json({ message: error instanceof Error ? error.message : 'Invalid transfer payload' });
    }
});
exports.default = router;
