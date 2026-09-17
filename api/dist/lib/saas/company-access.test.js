"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const control_plane_js_1 = require("./control-plane.js");
const tenant_scope_js_1 = require("./tenant-scope.js");
const repository_js_1 = require("../repository.js");
const company_access_js_1 = require("./company-access.js");
function mockRes() {
    const result = {};
    const res = {
        status(code) {
            result.statusCode = code;
            return this;
        },
        json(body) {
            result.body = body;
            return this;
        },
    };
    return { res, result };
}
(0, node_test_1.default)('suspended companies are detected from control-plane status', () => {
    const platform = control_plane_js_1.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    try {
        strict_1.default.equal((0, company_access_js_1.isCompanySuspended)('default-company'), false);
        control_plane_js_1.controlPlane.setCompanyStatus(platform, 'default-company', 'suspended', 'unit');
        strict_1.default.equal((0, company_access_js_1.isCompanySuspended)('default-company'), true);
        const { res, result } = mockRes();
        let nextCalled = false;
        (0, company_access_js_1.enforceSuspendedCompany)({ method: 'GET', path: '/locations', originalUrl: '/api/v1/locations', companyId: 'default-company' }, res, (() => { nextCalled = true; }));
        strict_1.default.equal(nextCalled, false);
        strict_1.default.equal(result.statusCode, 403);
        strict_1.default.equal(result.body?.code, 'COMPANY_SUSPENDED');
    }
    finally {
        control_plane_js_1.controlPlane.setCompanyStatus(platform, 'default-company', 'active', 'unit-restore');
    }
});
(0, node_test_1.default)('plan limits reject operational item creates at the current catalog size', () => {
    const previous = control_plane_js_1.controlPlane.limitOverrides.get('default-company');
    const current = (0, tenant_scope_js_1.itemsForCompany)('default-company', (0, repository_js_1.listItems)()).length;
    control_plane_js_1.controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), max_items: current });
    try {
        const { res, result } = mockRes();
        let nextCalled = false;
        (0, company_access_js_1.enforcePlanLimits)({ method: 'POST', path: '/items', originalUrl: '/api/v1/items', companyId: 'default-company' }, res, (() => { nextCalled = true; }));
        strict_1.default.equal(nextCalled, false);
        strict_1.default.equal(result.statusCode, 403);
        strict_1.default.equal(result.body?.code, 'PLAN_LIMIT_REACHED');
        const locations = (0, tenant_scope_js_1.locationsForCompany)('default-company', (0, repository_js_1.listLocations)()).length;
        strict_1.default.ok(locations >= 1);
    }
    finally {
        if (previous)
            control_plane_js_1.controlPlane.limitOverrides.set('default-company', previous);
        else
            control_plane_js_1.controlPlane.limitOverrides.delete('default-company');
    }
});
(0, node_test_1.default)('daily API usage cap rejects the next operational request', () => {
    const previous = control_plane_js_1.controlPlane.limitOverrides.get('default-company');
    const previousUsage = control_plane_js_1.controlPlane.usage.get('default-company');
    control_plane_js_1.controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), api_requests_per_day: 0 });
    try {
        const { res, result } = mockRes();
        let nextCalled = false;
        (0, company_access_js_1.enforceApiUsage)({ method: 'GET', path: '/locations', originalUrl: '/api/v1/locations', companyId: 'default-company' }, res, (() => { nextCalled = true; }));
        strict_1.default.equal(nextCalled, false);
        strict_1.default.equal(result.statusCode, 429);
        strict_1.default.equal(result.body?.code, 'USAGE_LIMIT_REACHED');
    }
    finally {
        if (previous)
            control_plane_js_1.controlPlane.limitOverrides.set('default-company', previous);
        else
            control_plane_js_1.controlPlane.limitOverrides.delete('default-company');
        if (previousUsage)
            control_plane_js_1.controlPlane.usage.set('default-company', previousUsage);
        else
            control_plane_js_1.controlPlane.usage.delete('default-company');
    }
});
