"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const seed_js_1 = require("../lib/seed.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const core_js_1 = __importDefault(require("./core.js"));
const operations_extension_js_1 = __importDefault(require("./operations-extension.js"));
const control_plane_js_1 = require("./control-plane.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const entitlements_js_1 = require("../lib/saas/entitlements.js");
const control_plane_js_2 = require("../lib/saas/control-plane.js");
const seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
function tokenFor(email) {
    const user = (0, enterprise_repository_js_1.findUserByEmail)(email);
    if (!user)
        throw new Error(`missing workspace user ${email}`);
    return (0, otp_auth_js_1.generateJWT)(user.id, user.companyId);
}
function seedJaipurAdmin() {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(seedPassword));
    if (!(0, enterprise_repository_js_1.findUserByEmail)('admin@jaipur.local')) {
        (0, enterprise_repository_js_1.createEnhancedUser)({
            id: 'user-jaipur-admin',
            companyId: 'company-jaipur',
            email: 'admin@jaipur.local',
            name: 'Jaipur Admin',
            role: 'ADMIN',
            branchIds: [],
            locationIds: ['loc-jaipur-1'],
            passwordHash: (0, otp_auth_js_1.hashPassword)(seedPassword),
            status: 'active',
        });
    }
}
async function withServer(run) {
    seedJaipurAdmin();
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, tenant_scope_js_1.enforceOperationalCompanyScope, entitlements_js_1.enforcePlanEntitlements);
    app.use('/api/v1', core_js_1.default);
    app.use('/api/v1', operations_extension_js_1.default);
    app.use('/control/v1', control_plane_js_1.controlRouter);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const url = `http://127.0.0.1:${address.port}`;
    try {
        await run(url);
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}
async function json(url, path, init = {}) {
    const response = await fetch(`${url}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
}
(0, node_test_1.default)('HTTP: starter Jaipur cannot read or create channel orders', async () => {
    await withServer(async (url) => {
        const jaipur = tokenFor('admin@jaipur.local');
        const grocery = tokenFor('admin@retail.local');
        const listed = await json(url, '/api/v1/orders', { headers: { Authorization: `Bearer ${jaipur}` } });
        strict_1.default.equal(listed.status, 403);
        strict_1.default.equal(listed.body.code, 'FEATURE_NOT_ENTITLED');
        strict_1.default.equal(listed.body.feature, 'OMS');
        const created = await json(url, '/api/v1/orders', {
            method: 'POST',
            headers: { Authorization: `Bearer ${jaipur}` },
            body: JSON.stringify({ channel: 'webstore', fulfillmentLocationId: 'loc-jaipur-1', lines: [{ itemId: 'item-jaipur-1', quantity: 1 }] }),
        });
        strict_1.default.equal(created.status, 403);
        strict_1.default.equal(created.body.code, 'FEATURE_NOT_ENTITLED');
        const items = await json(url, '/api/v1/items', { headers: { Authorization: `Bearer ${jaipur}` } });
        strict_1.default.equal(items.status, 200);
        const groceryOrders = await json(url, '/api/v1/orders', { headers: { Authorization: `Bearer ${grocery}` } });
        strict_1.default.equal(groceryOrders.status, 200);
        strict_1.default.equal(Array.isArray(groceryOrders.body.orders), true);
        const intelligence = await json(url, '/api/v1/intelligence/loc-jaipur-1', { headers: { Authorization: `Bearer ${jaipur}` } });
        strict_1.default.equal(intelligence.status, 403);
        strict_1.default.equal(intelligence.body.feature, 'ANALYTICS');
        const profile = await json(url, '/api/v1/workspace/profile', { headers: { Authorization: `Bearer ${jaipur}` } });
        strict_1.default.equal(profile.status, 200);
        strict_1.default.equal((profile.body.pack?.hide ?? []).includes('orders'), true);
        strict_1.default.equal((profile.body.pack?.hide ?? []).includes('intelligence'), true);
    });
});
(0, node_test_1.default)('HTTP: assigning starter to grocery freezes OMS until Pro is restored', async () => {
    const platform = control_plane_js_2.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    try {
        await withServer(async (url) => {
            const login = await json(url, '/control/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
            });
            strict_1.default.equal(login.status, 200);
            const grocery = tokenFor('admin@retail.local');
            const assigned = await json(url, '/control/v1/companies/default-company/plan', {
                method: 'PUT',
                headers: { Authorization: `Bearer ${login.body.token}` },
                body: JSON.stringify({ planId: 'starter', reason: 'http-entitlement' }),
            });
            strict_1.default.equal(assigned.status, 200);
            strict_1.default.equal(assigned.body.company.planId, 'starter');
            strict_1.default.equal(assigned.body.company.entitlements.OMS, false);
            const frozen = await json(url, '/api/v1/orders', { headers: { Authorization: `Bearer ${grocery}` } });
            strict_1.default.equal(frozen.status, 403);
            strict_1.default.equal(frozen.body.code, 'FEATURE_NOT_ENTITLED');
            const restored = await json(url, '/control/v1/companies/default-company/plan', {
                method: 'PUT',
                headers: { Authorization: `Bearer ${login.body.token}` },
                body: JSON.stringify({ planId: 'pro', reason: 'http-entitlement-restore' }),
            });
            strict_1.default.equal(restored.status, 200);
            strict_1.default.equal(restored.body.company.entitlements.OMS, true);
            const open = await json(url, '/api/v1/orders', { headers: { Authorization: `Bearer ${grocery}` } });
            strict_1.default.equal(open.status, 200);
        });
    }
    finally {
        control_plane_js_2.controlPlane.assignPlan(platform, 'default-company', 'pro', 'http-entitlement-restore');
    }
});
