"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const control_plane_js_1 = require("./control-plane.js");
const snapshot_js_1 = require("./snapshot.js");
(0, node_test_1.default)('published Studio config survives serialize and restore', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const selected = plane.selectCompany(login.user.id, 'default-company');
    const scope = plane.requireControlSession(selected.token).scope;
    plane.addStockColumn(scope, { name: 'Minimum Stock', key: 'minimum_stock', type: 'number' });
    plane.publish(scope);
    strict_1.default.equal(plane.runtimeConfig('default-company').page.columns.some((column) => column.key === 'minimum_stock'), true);
    const snapshot = (0, snapshot_js_1.serializeControlPlane)(plane);
    const restored = new control_plane_js_1.ControlPlane();
    (0, snapshot_js_1.applyControlPlaneSnapshot)(restored, snapshot);
    strict_1.default.equal(restored.companies.get('default-company')?.planId, 'pro');
    strict_1.default.equal(restored.runtimeConfig('default-company').page.columns.some((column) => column.key === 'minimum_stock'), true);
    strict_1.default.equal(restored.runtimeConfig('company-jaipur').page.columns.some((column) => column.key === 'minimum_stock'), false);
    strict_1.default.equal(restored.platformUsers.get('platform-super-1')?.email, 'superadmin@invexa.local');
    strict_1.default.ok(restored.audit.some((event) => event.action === 'CONFIG_PUBLISHED'));
    strict_1.default.equal((0, snapshot_js_1.isControlPlaneSnapshot)(snapshot), true);
});
(0, node_test_1.default)('restored control sessions remain hard-locked after restart', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const first = plane.selectCompany(login.user.id, 'default-company');
    const snapshot = (0, snapshot_js_1.serializeControlPlane)(plane);
    const restored = new control_plane_js_1.ControlPlane();
    (0, snapshot_js_1.applyControlPlaneSnapshot)(restored, snapshot);
    const live = restored.sessions.get(first.session.id);
    strict_1.default.equal(live?.status, 'active');
    strict_1.default.equal(live?.companyId, 'default-company');
    const resumed = restored.requireControlSession(first.token);
    strict_1.default.equal(resumed.scope.companyId, 'default-company');
});
(0, node_test_1.default)('code-defined plans missing from an older snapshot are merged back in', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const snapshot = (0, snapshot_js_1.serializeControlPlane)(plane);
    snapshot.plans = snapshot.plans.filter((plan) => plan.id !== 'enterprise');
    const restored = new control_plane_js_1.ControlPlane();
    (0, snapshot_js_1.applyControlPlaneSnapshot)(restored, snapshot);
    strict_1.default.equal(restored.plans.has('enterprise'), true);
    strict_1.default.equal(restored.plans.get('starter')?.limits.max_users, 25);
});
(0, node_test_1.default)('issued invoices and past-due holds survive serialize and restore', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const selected = plane.selectCompany(login.user.id, 'default-company');
    const scope = plane.requireControlSession(selected.token).scope;
    const invoice = plane.issueInvoice(scope, 'default-company');
    plane.markInvoicePastDue(scope, invoice.id);
    strict_1.default.equal(plane.billingSnapshot('default-company').billing.subscription, 'past_due');
    const restored = new control_plane_js_1.ControlPlane();
    (0, snapshot_js_1.applyControlPlaneSnapshot)(restored, (0, snapshot_js_1.serializeControlPlane)(plane));
    strict_1.default.equal(restored.invoices.get(invoice.id)?.status, 'past_due');
    strict_1.default.equal(restored.billingSnapshot('default-company').billing.subscription, 'past_due');
    strict_1.default.throws(() => restored.publish(scope), (error) => error instanceof control_plane_js_1.ControlPlaneError && error.code === 'BILLING_HOLD');
});
(0, node_test_1.default)('isControlPlaneSnapshot rejects unrelated JSON', () => {
    strict_1.default.equal((0, snapshot_js_1.isControlPlaneSnapshot)(null), false);
    strict_1.default.equal((0, snapshot_js_1.isControlPlaneSnapshot)({ version: 2, companies: [] }), false);
    strict_1.default.equal((0, snapshot_js_1.isControlPlaneSnapshot)({ version: 1 }), false);
});
