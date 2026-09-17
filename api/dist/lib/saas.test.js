"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const saas_js_1 = require("./saas.js");
(0, node_test_1.default)('starter plan does not include OMS or connectors; growth does', () => {
    const starter = (0, saas_js_1.findPlan)('starter');
    const growth = (0, saas_js_1.findPlan)('growth');
    strict_1.default.equal((0, saas_js_1.planAllows)(starter, 'counts'), true);
    strict_1.default.equal((0, saas_js_1.planAllows)(starter, 'oms'), false);
    strict_1.default.equal((0, saas_js_1.planAllows)(growth, 'oms'), true);
    strict_1.default.equal((0, saas_js_1.planAllows)(growth, 'connectors'), true);
});
(0, node_test_1.default)('validateOnboardInput rejects a blank company and an unknown plan', () => {
    strict_1.default.ok((0, saas_js_1.validateOnboardInput)({ companyName: '', adminName: 'A', adminEmail: 'a@b.com', planCode: 'starter' }));
    strict_1.default.ok((0, saas_js_1.validateOnboardInput)({ companyName: 'Acme', adminName: 'A', adminEmail: 'not-an-email', planCode: 'starter' }));
    strict_1.default.ok((0, saas_js_1.validateOnboardInput)({ companyName: 'Acme', adminName: 'A', adminEmail: 'a@b.com', planCode: 'gold' }));
    strict_1.default.equal((0, saas_js_1.validateOnboardInput)({ companyName: 'Acme Stores', adminName: 'Ada', adminEmail: 'ada@acme.test', planCode: 'growth' }), null);
});
(0, node_test_1.default)('provisionTenant creates a trial subscription and unique slug', () => {
    (0, saas_js_1.resetSaasStore)();
    const first = (0, saas_js_1.provisionTenant)({ companyName: 'Acme Stores', adminName: 'Ada', adminEmail: 'ada@acme.test', planCode: 'growth' });
    const second = (0, saas_js_1.provisionTenant)({ companyName: 'Acme Stores', adminName: 'Bea', adminEmail: 'bea@acme.test', planCode: 'starter' });
    strict_1.default.equal(first.tenant.slug, 'acme-stores');
    strict_1.default.equal(second.tenant.slug, 'acme-stores-2');
    strict_1.default.equal(first.subscription.status, 'TRIAL');
    strict_1.default.equal((0, saas_js_1.tenantAllows)(first.tenant.id, 'oms'), true);
    strict_1.default.equal((0, saas_js_1.tenantAllows)(second.tenant.id, 'oms'), false);
});
(0, node_test_1.default)('slugifyTenantName strips punctuation', () => {
    strict_1.default.equal((0, saas_js_1.slugifyTenantName)('  Invexa Retail — North  '), 'invexa-retail-north');
});
