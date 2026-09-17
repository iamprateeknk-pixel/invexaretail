"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const control_plane_js_1 = require("./control-plane.js");
function locked(plane, companyId = 'default-company') {
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const selected = plane.selectCompany(login.user.id, companyId);
    return plane.requireControlSession(selected.token).scope;
}
(0, node_test_1.default)('P0: ScopeContext rejects a locked session from touching another company', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const scope = locked(plane, 'default-company');
    strict_1.default.equal(scope.companyId, 'default-company');
    strict_1.default.throws(() => plane.assertCompanyScope(scope, 'company-jaipur'), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'COMPANY_SCOPE_MISMATCH' && error.status === 403);
    strict_1.default.equal(plane.audit.some((event) => event.action === 'COMPANY_SCOPE_DENIED'), true);
});
(0, node_test_1.default)('P1: company switch closes the previous control session', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const first = plane.selectCompany(login.user.id, 'default-company');
    const second = plane.selectCompany(login.user.id, 'company-jaipur');
    strict_1.default.equal(first.session.status, 'closed');
    strict_1.default.equal(second.session.status, 'active');
    strict_1.default.throws(() => plane.requireControlSession(first.token), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'SESSION_CLOSED');
    const live = plane.requireControlSession(second.token);
    strict_1.default.equal(live.scope.companyId, 'company-jaipur');
});
(0, node_test_1.default)('P2: plan limits and entitlements are server-enforced', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const jaipur = locked(plane, 'company-jaipur');
    strict_1.default.equal(plane.isFeatureEnabled('company-jaipur', 'OMS'), false);
    strict_1.default.throws(() => plane.assertFeature('company-jaipur', 'OMS'), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'FEATURE_NOT_ENTITLED');
    for (let index = 0; index < 24; index += 1) {
        plane.createCompanyUser(jaipur, { email: `staff${index}@jaipur.local`, name: `Staff ${index}`, role: 'STORE_USER' });
    }
    strict_1.default.throws(() => plane.createCompanyUser(jaipur, { email: 'overflow@jaipur.local', name: 'Overflow', role: 'STORE_USER' }), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'PLAN_LIMIT_REACHED');
    const platform = plane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    plane.assignPlan(platform, 'company-jaipur', 'pro', 'raise seats');
    strict_1.default.equal(plane.isFeatureEnabled('company-jaipur', 'OMS'), true);
    const created = plane.createCompanyUser(jaipur, { email: 'overflow@jaipur.local', name: 'Overflow', role: 'STORE_USER' });
    strict_1.default.equal(created.email, 'overflow@jaipur.local');
    plane.assignPlan(platform, 'company-jaipur', 'starter', 'restore starter');
    strict_1.default.equal(plane.isFeatureEnabled('company-jaipur', 'OMS'), false);
});
(0, node_test_1.default)('P3: primary admin is protected and passwords are never retrieved', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const scope = locked(plane);
    const staff = plane.createCompanyUser(scope, { email: 'picker@retail.local', name: 'Picker', role: 'WAREHOUSE_PICKER' });
    const reset = plane.resetPassword(scope, staff.id);
    strict_1.default.match(reset.temporaryPassword, /Invexa/);
    strict_1.default.equal('passwordHash' in staff, false);
    strict_1.default.throws(() => plane.deleteCompanyUser(scope, 'user-admin-1'), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'PRIMARY_ADMIN_PROTECTED');
    strict_1.default.throws(() => plane.createCompanyUser(scope, { email: 'root@x.local', name: 'Root', role: 'PLATFORM_SUPER_ADMIN' }), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'ROLE_NOT_ASSIGNABLE');
});
(0, node_test_1.default)('P4-P6: Stock Studio draft, preview, publish and rollback stay company-scoped', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const grocery = locked(plane, 'default-company');
    plane.addStockColumn(grocery, {
        name: 'Minimum Stock',
        key: 'minimum_stock',
        type: 'number',
        defaultValue: 0,
        visibleRoles: ['ADMIN', 'BRANCH_MANAGER'],
        editableRoles: ['ADMIN'],
    });
    plane.setActionEnabled(grocery, 'export', false);
    plane.moveTab(grocery, 'lots', 1);
    const preview = plane.preview(grocery, { role: 'ADMIN', device: 'desktop' });
    strict_1.default.equal(preview.page.columns.some((column) => column.key === 'minimum_stock'), true);
    const storePreview = plane.preview(grocery, { role: 'STORE_USER', device: 'desktop' });
    strict_1.default.equal(storePreview.page.columns.some((column) => column.key === 'minimum_stock'), false);
    const published = plane.publish(grocery);
    strict_1.default.equal(published.status, 'published');
    const groceryRuntime = plane.runtimeConfig('default-company', 'ADMIN');
    const jaipurRuntime = plane.runtimeConfig('company-jaipur', 'ADMIN');
    strict_1.default.equal(groceryRuntime.page.columns.some((column) => column.key === 'minimum_stock'), true);
    strict_1.default.equal(jaipurRuntime.page.columns.some((column) => column.key === 'minimum_stock'), false);
    const restored = plane.rollback(grocery, 1);
    strict_1.default.equal(plane.runtimeConfig('default-company').page.columns.some((column) => column.key === 'minimum_stock'), false);
    strict_1.default.ok(restored.version > 1);
});
(0, node_test_1.default)('P5: platform kill switch beats company and plan entitlements', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const platform = plane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    strict_1.default.equal(plane.isFeatureEnabled('default-company', 'OMS'), true);
    plane.setKillSwitch(platform, 'OMS', false, 'incident');
    strict_1.default.equal(plane.isFeatureEnabled('default-company', 'OMS'), false);
    strict_1.default.throws(() => plane.assertFeature('default-company', 'OMS'), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'KILL_SWITCH' && error.status === 403);
    const grocery = locked(plane, 'default-company');
    strict_1.default.throws(() => plane.setCompanyModule(grocery, 'OMS', true), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'SAFETY_FLOOR');
    plane.setKillSwitch(platform, 'INVENTORY', false, 'inventory-incident');
    strict_1.default.throws(() => plane.enqueueMutation({
        mutationId: 'mut-kill',
        tenantId: plane.tenantId,
        companyId: 'default-company',
        userId: 'user-store-1',
        deviceId: 'device-1',
        entityType: 'inventory',
        actionType: 'STOCK_ADJUST',
        payload: { itemId: 'item-1', delta: -1 },
    }), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'KILL_SWITCH');
});
(0, node_test_1.default)('P7-P8: workflow simulation pins in-flight version and rules fire', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const auto = plane.simulateWorkflow('default-company', 'transfer.approval', { value: 50000 });
    const manager = plane.simulateWorkflow('default-company', 'transfer.approval', { value: 150000 });
    strict_1.default.equal(auto.outcome, 'auto_approve');
    strict_1.default.equal(manager.outcome, 'manager_approval');
    const outcomes = plane.evaluateRule('default-company', { branchCity: 'Jaipur', adjustmentValue: 15000 });
    strict_1.default.deepEqual(outcomes, ['BRANCH_MANAGER']);
});
(0, node_test_1.default)('Rule Builder: a rule created through Studio fires the same generic engine as a seeded one', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const scope = locked(plane);
    plane.upsertRule(scope, {
        key: 'expiry_task',
        name: 'Near-expiry task',
        condition: { daysToExpiryLt: 30 },
        outcome: { action: 'CREATE_TASK:EXPIRY_ACTION' },
    });
    plane.publish(scope);
    strict_1.default.deepEqual(plane.evaluateRule('default-company', { daysToExpiry: 10 }), ['CREATE_TASK:EXPIRY_ACTION']);
    // Above threshold: the new rule should not fire, and the seeded high-value
    // rule should not fire either since branchCity/adjustmentValue are absent.
    strict_1.default.deepEqual(plane.evaluateRule('default-company', { daysToExpiry: 45 }), []);
    // Both rules can fire together off one context.
    strict_1.default.deepEqual(plane.evaluateRule('default-company', { daysToExpiry: 5, branchCity: 'Jaipur', adjustmentValue: 20000 }).sort(), ['BRANCH_MANAGER', 'CREATE_TASK:EXPIRY_ACTION'].sort());
});
(0, node_test_1.default)('Mobile Policy Builder: upsert updates an existing role in place and adds new roles', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const scope = locked(plane);
    const seeded = plane.ensureDraft(scope).mobilePolicies.length;
    plane.upsertMobilePolicy(scope, {
        role: 'STORE_USER',
        offlineMaxHours: 6,
        syncScope: ['stock'],
        navigation: ['dashboard', 'stock'],
        encryptedLocalStore: true,
    });
    const afterUpdate = plane.ensureDraft(scope);
    strict_1.default.equal(afterUpdate.mobilePolicies.length, seeded);
    const storeUser = afterUpdate.mobilePolicies.find((policy) => policy.role === 'STORE_USER');
    strict_1.default.equal(storeUser?.offlineMaxHours, 6);
    strict_1.default.deepEqual(storeUser?.syncScope, ['stock']);
    plane.upsertMobilePolicy(scope, {
        role: 'AUDITOR',
        offlineMaxHours: 2,
        syncScope: ['counts'],
        navigation: ['counts'],
        encryptedLocalStore: true,
    });
    strict_1.default.equal(plane.ensureDraft(scope).mobilePolicies.length, seeded + 1);
});
(0, node_test_1.default)('Field Builder: addField works across entity types and rejects duplicate keys per entity', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const scope = locked(plane);
    plane.addField(scope, { entityType: 'transfer', key: 'carrier_note', name: 'Carrier note', type: 'text' });
    plane.addField(scope, { entityType: 'order', key: 'carrier_note', name: 'Carrier note', type: 'text' });
    const draft = plane.ensureDraft(scope);
    strict_1.default.equal(draft.fields.filter((field) => field.fieldKey === 'carrier_note').length, 2);
    strict_1.default.equal(draft.fields.find((field) => field.entityType === 'transfer')?.label, 'Carrier note');
    strict_1.default.throws(() => plane.addField(scope, { entityType: 'transfer', key: 'carrier_note', name: 'Dup', type: 'text' }), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'RESERVED_FIELD');
    // A field on a non-stock entity does not leak into the stock page's columns.
    strict_1.default.equal(draft.page.columns.some((column) => column.key === 'carrier_note'), false);
});
(0, node_test_1.default)('Workflow Builder: a workflow created through Studio simulates by its own key and threshold', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const scope = locked(plane);
    plane.upsertWorkflow(scope, {
        key: 'count.approval',
        name: 'Count variance approval',
        version: 1,
        graph: {
            nodes: [
                { id: 'start', type: 'trigger', config: { event: 'count.approval.created' } },
                { id: 'check', type: 'condition', config: { field: 'value', op: 'lte', amount: 5000 } },
                { id: 'auto', type: 'action', config: { action: 'AUTO_APPROVE' } },
                { id: 'manager', type: 'approval', config: { role: 'BRANCH_MANAGER' } },
            ],
        },
    });
    plane.publish(scope);
    strict_1.default.equal(plane.simulateWorkflow('default-company', 'count.approval', { value: 2000 }).outcome, 'auto_approve');
    strict_1.default.equal(plane.simulateWorkflow('default-company', 'count.approval', { value: 9000 }).outcome, 'manager_approval');
    // The pre-existing seeded workflow keeps its own, different threshold.
    strict_1.default.equal(plane.simulateWorkflow('default-company', 'transfer.approval', { value: 9000 }).outcome, 'auto_approve');
});
(0, node_test_1.default)('P9-P10: offline stock mutations are idempotent and never last-write-wins', () => {
    const plane = new control_plane_js_1.ControlPlane();
    strict_1.default.equal(plane.stockOnHand('default-company', 'item-1'), 10);
    const first = plane.enqueueMutation({
        mutationId: 'mut-1',
        tenantId: plane.tenantId,
        companyId: 'default-company',
        userId: 'user-store-1',
        deviceId: 'device-1',
        entityType: 'inventory',
        actionType: 'STOCK_ADJUST',
        payload: { itemId: 'item-1', delta: -2 },
    });
    const retry = plane.enqueueMutation({
        mutationId: 'mut-1',
        tenantId: plane.tenantId,
        companyId: 'default-company',
        userId: 'user-store-1',
        deviceId: 'device-1',
        entityType: 'inventory',
        actionType: 'STOCK_ADJUST',
        payload: { itemId: 'item-1', delta: -2 },
    });
    plane.enqueueMutation({
        mutationId: 'mut-2',
        tenantId: plane.tenantId,
        companyId: 'default-company',
        userId: 'server',
        deviceId: 'api',
        entityType: 'inventory',
        actionType: 'STOCK_ADJUST',
        payload: { itemId: 'item-1', delta: -3 },
    });
    strict_1.default.equal(first.status, 'synced');
    strict_1.default.equal(retry.result, first.result);
    strict_1.default.equal(plane.stockOnHand('default-company', 'item-1'), 5);
    const overwrite = plane.enqueueMutation({
        mutationId: 'mut-3',
        tenantId: plane.tenantId,
        companyId: 'default-company',
        userId: 'user-store-1',
        deviceId: 'device-1',
        entityType: 'inventory',
        actionType: 'STOCK_ADJUST',
        payload: { itemId: 'item-1', quantity: 8 },
    });
    strict_1.default.equal(overwrite.status, 'rejected');
    const revoked = plane.enqueueMutation({
        mutationId: 'mut-4',
        tenantId: plane.tenantId,
        companyId: 'default-company',
        userId: 'user-store-1',
        deviceId: 'device-1',
        entityType: 'count',
        actionType: 'COUNT_SUBMIT',
        payload: { permissionRevoked: true },
    });
    strict_1.default.equal(revoked.status, 'rejected');
});
(0, node_test_1.default)('P11-P12: integrations, billing usage and health are company scoped', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const grocery = locked(plane, 'default-company');
    const key = plane.createApiKey(grocery, 'POS', ['inventory.read']);
    strict_1.default.match(key.token, /^invx_/);
    strict_1.default.equal(plane.verifyApiKey(key.token)?.companyId, 'default-company');
    strict_1.default.equal(plane.verifyApiKey('invx_deadbeefdeadbeefdeadbeefdeadbeef'), null);
    plane.createWebhook(grocery, 'https://example.test/hooks', ['stock.low']);
    plane.upsertConnector(grocery, 'shopify');
    plane.recordUsage('default-company', 'api_requests', 9);
    const billing = plane.billingSnapshot('default-company');
    strict_1.default.equal(billing.usage.api_requests, 9);
    strict_1.default.equal(plane.health().ok, true);
    const invoice = plane.issueInvoice(grocery, 'default-company');
    strict_1.default.equal(invoice.status, 'open');
    plane.markInvoicePastDue(grocery, invoice.id);
    strict_1.default.equal(plane.billingSnapshot('default-company').billing.subscription, 'past_due');
    strict_1.default.throws(() => plane.publish(grocery), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'BILLING_HOLD' && error.status === 402);
    plane.payInvoice(grocery, invoice.id);
    strict_1.default.equal(plane.billingSnapshot('default-company').billing.subscription, 'active');
    const firstOpen = plane.issueInvoice(grocery, 'default-company');
    const stillOpen = plane.issueInvoice(grocery, 'default-company');
    plane.markInvoicePastDue(grocery, firstOpen.id);
    plane.payInvoice(grocery, firstOpen.id);
    strict_1.default.equal(stillOpen.status, 'open');
    strict_1.default.equal(plane.billingSnapshot('default-company').billing.subscription, 'active');
    const firstDue = plane.issueInvoice(grocery, 'default-company');
    const secondDue = plane.issueInvoice(grocery, 'default-company');
    plane.markInvoicePastDue(grocery, firstDue.id);
    plane.markInvoicePastDue(grocery, secondDue.id);
    plane.payInvoice(grocery, firstDue.id);
    strict_1.default.equal(plane.billingSnapshot('default-company').billing.subscription, 'past_due');
    plane.payInvoice(grocery, secondDue.id);
    strict_1.default.equal(plane.billingSnapshot('default-company').billing.subscription, 'active');
    plane.revokeApiKey(grocery, key.id);
    strict_1.default.throws(() => plane.verifyApiKey(key.token), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'API_KEY_REVOKED');
    const jaipur = locked(plane, 'company-jaipur');
    strict_1.default.throws(() => plane.createApiKey(jaipur, 'POS', ['inventory.read']), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'FEATURE_NOT_ENTITLED');
});
(0, node_test_1.default)('suspended companies close locked sessions and cannot be selected', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const grocery = plane.selectCompany(login.user.id, 'default-company');
    const groceryScope = plane.requireControlSession(grocery.token).scope;
    strict_1.default.throws(() => plane.setCompanyStatus(groceryScope, 'company-jaipur', 'suspended', 'cross-tenant'), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'COMPANY_SCOPE_MISMATCH' && error.status === 403);
    const platform = plane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    plane.setCompanyStatus(platform, 'default-company', 'suspended', 'unit-test');
    strict_1.default.equal(grocery.session.status, 'closed');
    strict_1.default.throws(() => plane.requireControlSession(grocery.token), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'SESSION_CLOSED');
    strict_1.default.throws(() => plane.selectCompany(login.user.id, 'default-company'), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'COMPANY_SUSPENDED' && error.status === 403);
    strict_1.default.deepEqual(plane.health().suspendedCompanies, ['default-company']);
    plane.setCompanyStatus(platform, 'default-company', 'active', 'unit-test-restore');
    const restored = plane.selectCompany(login.user.id, 'default-company');
    strict_1.default.equal(restored.session.status, 'active');
});
(0, node_test_1.default)('platform onboarding creates a company with a one-time admin password', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const grocery = plane.selectCompany(login.user.id, 'default-company');
    const groceryScope = plane.requireControlSession(grocery.token).scope;
    strict_1.default.throws(() => plane.createCompany(groceryScope, { name: 'Kota Fresh', planId: 'starter', adminEmail: 'admin@kota.local', adminName: 'Kota Admin' }), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'SESSION_REQUIRED' && error.status === 401);
    const platform = plane.requireControlSession(login.token).scope;
    const created = plane.createCompany(platform, {
        name: 'Kota Fresh',
        planId: 'starter',
        adminEmail: 'admin@kota.local',
        adminName: 'Kota Admin',
    });
    strict_1.default.equal(created.company.name, 'Kota Fresh');
    strict_1.default.equal(created.company.status, 'active');
    strict_1.default.match(created.temporaryPassword, /^Invexa/);
    strict_1.default.throws(() => plane.createCompany(platform, { name: 'Kota Two', planId: 'starter', adminEmail: 'admin@kota.local', adminName: 'Dup' }), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'EMAIL_IN_USE' && error.status === 409);
});
