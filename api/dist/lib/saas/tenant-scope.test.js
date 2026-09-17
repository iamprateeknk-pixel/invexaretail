"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const tenant_scope_js_1 = require("./tenant-scope.js");
(0, node_test_1.default)('seed grocery locations and items belong to default-company only', () => {
    (0, tenant_scope_js_1.seedDefaultTenantOwnership)();
    strict_1.default.equal((0, tenant_scope_js_1.companyOwnsLocation)(tenant_scope_js_1.DEFAULT_COMPANY_ID, 'loc-1'), true);
    strict_1.default.equal((0, tenant_scope_js_1.companyOwnsLocation)(tenant_scope_js_1.JAIPUR_COMPANY_ID, 'loc-1'), false);
    strict_1.default.equal((0, tenant_scope_js_1.companyOwnsItem)(tenant_scope_js_1.DEFAULT_COMPANY_ID, 'item-1001'), true);
    strict_1.default.equal((0, tenant_scope_js_1.companyOwnsItem)(tenant_scope_js_1.JAIPUR_COMPANY_ID, 'item-1001'), false);
    strict_1.default.equal((0, tenant_scope_js_1.locationsForCompany)(tenant_scope_js_1.JAIPUR_COMPANY_ID, [{ id: 'loc-1' }, { id: 'loc-2' }]).length, 0);
    strict_1.default.equal((0, tenant_scope_js_1.itemsForCompany)(tenant_scope_js_1.DEFAULT_COMPANY_ID, [{ id: 'item-1001' }]).length, 1);
});
(0, node_test_1.default)('a newly created Jaipur location is invisible to grocery', () => {
    (0, tenant_scope_js_1.ensureJaipurOperationalWorkspace)();
    strict_1.default.equal((0, tenant_scope_js_1.companyOwnsLocation)(tenant_scope_js_1.JAIPUR_COMPANY_ID, 'loc-jaipur-1'), true);
    strict_1.default.equal((0, tenant_scope_js_1.companyOwnsLocation)(tenant_scope_js_1.DEFAULT_COMPANY_ID, 'loc-jaipur-1'), false);
    strict_1.default.equal((0, tenant_scope_js_1.companyOwnsItem)(tenant_scope_js_1.DEFAULT_COMPANY_ID, 'item-jaipur-1'), false);
    strict_1.default.equal((0, tenant_scope_js_1.locationsForCompany)(tenant_scope_js_1.JAIPUR_COMPANY_ID, [{ id: 'loc-1' }, { id: 'loc-jaipur-1' }]).map((row) => row.id).join(','), 'loc-jaipur-1');
});
(0, node_test_1.default)('operational middleware returns 403 when a locked company asks for another company location', () => {
    (0, tenant_scope_js_1.seedDefaultTenantOwnership)();
    let status = 200;
    let body;
    const req = {
        companyId: tenant_scope_js_1.JAIPUR_COMPANY_ID,
        params: { locationId: 'loc-1' },
        query: {},
        body: {},
        path: '/stock/loc-1',
    };
    const res = {
        status(code) {
            status = code;
            return this;
        },
        json(payload) {
            body = payload;
            return this;
        },
    };
    let nextCalled = false;
    (0, tenant_scope_js_1.enforceOperationalCompanyScope)(req, res, () => {
        nextCalled = true;
    });
    strict_1.default.equal(nextCalled, false);
    strict_1.default.equal(status, 403);
    strict_1.default.deepEqual(body, { error: 'Company scope mismatch', code: 'COMPANY_SCOPE_MISMATCH' });
});
