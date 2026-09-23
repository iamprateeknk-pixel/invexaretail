"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Week 8: Branch management, migrated from the unmounted routes/foundation.ts
// (dead code with no live equivalent - see docs/route-ownership-matrix.md).
// Thin route -> lib/branch-service.ts, per this week's architecture.
const express_1 = require("express");
const db_js_1 = require("../lib/db.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const access_control_js_1 = require("../lib/access-control.js");
const branch_service_js_1 = require("../lib/branch-service.js");
const router = (0, express_1.Router)();
router.use(enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, access_control_js_1.enforcePermissionOverrides);
function firstParam(value) {
    return Array.isArray(value) ? value[0] : (value ?? '');
}
const ADMIN_ROLES = ['ADMIN', 'ADMIN_USER'];
function requireAdmin(req, res) {
    if (!ADMIN_ROLES.includes(req.user.role)) {
        res.status(403).json({ message: 'Admin access required.' });
        return false;
    }
    return true;
}
router.get('/branches', async (_req, res) => {
    const branches = await db_js_1.prisma.branch.findMany({ orderBy: { code: 'asc' }, include: { locations: true } });
    return res.json({ branches });
});
router.post('/branches', async (req, res) => {
    if (!requireAdmin(req, res))
        return;
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!code || !name)
        return res.status(400).json({ message: 'Branch code and name are required.' });
    try {
        const branch = await (0, branch_service_js_1.createBranch)({
            code, name, type: req.body.type, address: req.body.address, phone: req.body.phone,
            email: req.body.email, managerId: req.body.managerId, workingHours: req.body.workingHours,
        });
        return res.status(201).json({ branch });
    }
    catch (error) {
        if (error instanceof branch_service_js_1.BranchCodeConflictError)
            return res.status(409).json({ message: error.message });
        throw error;
    }
});
router.patch('/branches/:id', async (req, res) => {
    if (!requireAdmin(req, res))
        return;
    try {
        const { code: _ignoredCode, ...rest } = req.body;
        const branch = await (0, branch_service_js_1.updateBranch)(firstParam(req.params.id), rest);
        return res.json({ branch });
    }
    catch (error) {
        if (error instanceof branch_service_js_1.BranchNotFoundError)
            return res.status(404).json({ message: error.message });
        throw error;
    }
});
router.post('/branches/:id/archive', async (req, res) => {
    if (!requireAdmin(req, res))
        return;
    try {
        const branch = await (0, branch_service_js_1.archiveBranch)(firstParam(req.params.id));
        return res.json({ branch });
    }
    catch (error) {
        if (error instanceof branch_service_js_1.BranchNotFoundError)
            return res.status(404).json({ message: error.message });
        if (error instanceof branch_service_js_1.BranchHasActiveWorkError)
            return res.status(409).json({ message: error.message, blockers: error.blockers });
        throw error;
    }
});
exports.default = router;
