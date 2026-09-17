"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const control_plane_js_1 = require("./saas/control-plane.js");
const control_plane_js_2 = require("./saas/control-plane.js");
const webhook_bridge_js_1 = require("./webhook-bridge.js");
const webhook_dispatcher_js_1 = require("./webhook-dispatcher.js");
const webhook_store_js_1 = require("./webhook-store.js");
(0, node_test_1.default)('event company is resolved from location then item ownership', () => {
    strict_1.default.equal((0, webhook_bridge_js_1.resolveCompanyIdFromEvent)({ locationId: 'loc-1' }), 'default-company');
    strict_1.default.equal((0, webhook_bridge_js_1.resolveCompanyIdFromEvent)({ locationId: 'loc-jaipur-1' }), 'company-jaipur');
    strict_1.default.equal((0, webhook_bridge_js_1.resolveCompanyIdFromEvent)({ itemId: 'item-jaipur-1' }), 'company-jaipur');
});
(0, node_test_1.default)('Control Plane webhooks receive operational events only for their company', async () => {
    (0, webhook_store_js_1.resetWebhookStore)();
    control_plane_js_2.controlPlane.reset();
    const plane = control_plane_js_2.controlPlane;
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const grocery = plane.selectCompany(login.user.id, 'default-company');
    const groceryScope = plane.requireControlSession(grocery.token).scope;
    const created = plane.createWebhook(groceryScope, 'https://hooks.example.com/grocery', ['count.reviewed'], 'Grocery ops');
    plane.webhooks.set('hook-jaipur', {
        id: 'hook-jaipur',
        companyId: 'company-jaipur',
        name: 'Jaipur ops',
        url: 'https://hooks.example.com/jaipur',
        events: ['count.reviewed'],
        status: 'active',
        signingSecret: 'jaipur-secret',
        createdAt: new Date().toISOString(),
    });
    const calls = [];
    (0, webhook_dispatcher_js_1.setWebhookTransport)(async (url) => {
        calls.push(url);
        return { status: 204 };
    });
    try {
        const delivered = await (0, webhook_dispatcher_js_1.dispatchWebhookEvent)({
            type: 'count.reviewed',
            entityId: 'count-1',
            data: { countId: 'count-1', locationId: 'loc-1', status: 'APPROVED' },
        });
        strict_1.default.equal(delivered.length, 1);
        strict_1.default.equal(delivered[0].status, 'DELIVERED');
        strict_1.default.deepEqual(calls, ['https://hooks.example.com/grocery']);
        strict_1.default.equal((0, webhook_bridge_js_1.listControlPlaneWebhookTargets)('default-company', 'count.reviewed').some((hook) => hook.id === created.id), true);
        strict_1.default.equal((0, webhook_bridge_js_1.listControlPlaneWebhookTargets)('company-jaipur', 'count.reviewed').some((hook) => hook.id === 'hook-jaipur'), true);
    }
    finally {
        (0, webhook_dispatcher_js_1.resetWebhookTransport)();
    }
});
(0, node_test_1.default)('Starter cannot register Control Plane webhooks', () => {
    const plane = new control_plane_js_1.ControlPlane();
    const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
    const jaipur = plane.selectCompany(login.user.id, 'company-jaipur');
    const scope = plane.requireControlSession(jaipur.token).scope;
    strict_1.default.throws(() => plane.createWebhook(scope, 'https://hooks.example.com/jaipur', ['stock.low'], 'Jaipur'), (error) => error instanceof Error && 'code' in error && error.code === 'FEATURE_NOT_ENTITLED');
});
