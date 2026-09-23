"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Week 12: thin route over lib/reporting-repository.ts, continuing the
// Week 8/10/11 extraction pattern. Additive - the pre-existing
// /reports/transfer-cycle, /reports/count-accuracy and /reports/audit-export
// routes in routes/command-center.ts, and /companies/:companyId/dashboard/summary
// in routes/enterprise-analytics.ts, are untouched by this module.
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const access_control_js_1 = require("../lib/access-control.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const reporting_repository_js_1 = require("../lib/reporting-repository.js");
const router = (0, express_1.Router)();
router.use(enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, access_control_js_1.enforcePermissionOverrides);
function tenantContextFor(req) {
    return {
        companyId: req.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
        tenantId: tenant_scope_js_1.DEFAULT_TENANT_ID,
        userId: req.user.id,
        role: req.user.role,
    };
}
router.get('/reports/dashboard', async (req, res) => {
    const summary = await (0, reporting_repository_js_1.getDashboardSummary)(tenantContextFor(req));
    return res.json(summary);
});
router.get('/reports/exceptions', async (req, res) => {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
    const page = await (0, reporting_repository_js_1.listOpenExceptions)(tenantContextFor(req), { cursor, limit: Number.isFinite(limit) ? limit : undefined });
    return res.json(page);
});
exports.default = router;
