"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCompanySuspended = isCompanySuspended;
exports.rejectSuspendedCompany = rejectSuspendedCompany;
exports.enforceSuspendedCompany = enforceSuspendedCompany;
exports.enforcePlanLimits = enforcePlanLimits;
exports.enforceApiUsage = enforceApiUsage;
const control_plane_js_1 = require("./control-plane.js");
const repository_js_1 = require("../repository.js");
const enterprise_repository_js_1 = require("../enterprise-repository.js");
const tenant_scope_js_1 = require("./tenant-scope.js");
function isAuthRoute(req) {
    return /\/auth\//.test(`${req.originalUrl ?? ''} ${req.path ?? ''}`);
}
function lastSegment(path) {
    const segments = String(path ?? '').split('/').filter(Boolean);
    return segments[segments.length - 1] ?? '';
}
function isCompanySuspended(companyId) {
    if (!companyId)
        return false;
    return control_plane_js_1.controlPlane.companies.get(companyId)?.status === 'suspended';
}
function rejectSuspendedCompany(companyId, res) {
    if (!isCompanySuspended(companyId))
        return false;
    res.status(403).json({ error: 'Company is suspended', code: 'COMPANY_SUSPENDED' });
    return true;
}
function enforceSuspendedCompany(req, res, next) {
    if (req.method === 'OPTIONS' || isAuthRoute(req)) {
        next();
        return;
    }
    if (rejectSuspendedCompany(req.companyId, res))
        return;
    next();
}
function sendLimitError(res, error) {
    if (error instanceof control_plane_js_1.ControlPlaneError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return true;
    }
    return false;
}
function enforcePlanLimits(req, res, next) {
    if (req.method !== 'POST') {
        next();
        return;
    }
    const companyId = req.companyId;
    if (!companyId || isAuthRoute(req)) {
        next();
        return;
    }
    const resource = lastSegment(req.path ?? '');
    try {
        if (resource === 'items') {
            control_plane_js_1.controlPlane.assertLimit(companyId, 'max_items', (0, tenant_scope_js_1.itemsForCompany)(companyId, (0, repository_js_1.listItems)()).length + 1);
        }
        else if (resource === 'locations') {
            control_plane_js_1.controlPlane.assertLimit(companyId, 'max_branches', (0, tenant_scope_js_1.locationsForCompany)(companyId, (0, repository_js_1.listLocations)()).length + 1);
        }
        else if (resource === 'users') {
            const users = (0, repository_js_1.listUsers)().filter((user) => ((0, enterprise_repository_js_1.findUserById)(user.id)?.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID) === companyId);
            control_plane_js_1.controlPlane.assertLimit(companyId, 'max_users', users.length + 1);
        }
    }
    catch (error) {
        if (sendLimitError(res, error))
            return;
        throw error;
    }
    next();
}
function enforceApiUsage(req, res, next) {
    if (req.method === 'OPTIONS' || req.method === 'HEAD' || isAuthRoute(req)) {
        next();
        return;
    }
    const companyId = req.companyId;
    if (!companyId) {
        next();
        return;
    }
    const usage = control_plane_js_1.controlPlane.usage.get(companyId) ?? {};
    const nextCount = (usage.api_requests ?? 0) + 1;
    const max = control_plane_js_1.controlPlane.effectiveLimits(companyId).api_requests_per_day;
    if (typeof max === 'number' && nextCount > max) {
        res.status(429).json({
            error: `Daily API request limit reached (${max})`,
            code: 'USAGE_LIMIT_REACHED',
        });
        return;
    }
    control_plane_js_1.controlPlane.recordUsage(companyId, 'api_requests', 1);
    next();
}
