"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Real-Postgres coverage for the granular per-user permission control (admin -> function-level
// access for any user) and the two gaps closed alongside it:
//  - enforcePermissionOverrides was never applied by campaigns.ts / item-master.ts /
//    import-control-center.ts / transfer-logistics.ts / command-center.ts, so an admin's explicit
//    DENY on a user silently had no effect on routes served by those five routers.
//  - "give this picker the same access as that store user" is now a single action:
//    POST /users/:userId/permissions/copy-from/:sourceUserId.
// Skipped unless TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const core_js_1 = __importDefault(require("./core.js"));
const transfer_logistics_js_1 = __importDefault(require("./transfer-logistics.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', transfer_logistics_js_1.default);
    app.use('/api/v1', core_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('bind failed');
    const call = async (method, path, token, body) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, body: (await response.json().catch(() => ({}))) };
    };
    try {
        await run(call);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
async function makeUser(companyId, role, tag) {
    const userId = `perm-user-${tag}-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: tag, email: `${userId}@test.invexa.local`, passwordHash: 'x', role: role, assignedLocations: '[]', companyId } });
    (0, enterprise_repository_js_1.createEnhancedUser)({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: tag, role: role, branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
    return { userId, token: (0, otp_auth_js_1.generateJWT)(userId, companyId) };
}
async function makeCompany() {
    const companyId = `perm-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const admin = await makeUser(companyId, 'ADMIN', 'admin');
    return { companyId, ...admin };
}
integration('a per-user DENY override actually blocks a route in one of the five routers that never enforced it (audit: control function)', async () => {
    const a = await makeCompany();
    const picker = await makeUser(a.companyId, 'WAREHOUSE_PICKER', 'picker');
    await withServer(async (call) => {
        // Before any override, a warehouse picker is normally allowed to open a (nonexistent) pack view -
        // the request reaches the route's own 404, not a permission rejection.
        const before = await call('GET', '/transfers/does-not-exist/pack', picker.token);
        strict_1.default.equal(before.status, 404);
        const put = await call('PUT', `/users/${picker.userId}/permissions`, a.token, {
            permissions: [{ module: 'TRANSFER', action: 'VIEW', denied: true, reason: 'test' }],
        });
        strict_1.default.equal(put.status, 200, JSON.stringify(put.body));
        const denied = await call('GET', '/transfers/does-not-exist/pack', picker.token);
        strict_1.default.equal(denied.status, 403, JSON.stringify(denied.body));
        strict_1.default.equal(denied.body.code, 'PERMISSION_DENIED');
        // Clearing the override (an empty permission set) restores normal role-based access.
        const clear = await call('PUT', `/users/${picker.userId}/permissions`, a.token, { permissions: [] });
        strict_1.default.equal(clear.status, 200);
        const restored = await call('GET', '/transfers/does-not-exist/pack', picker.token);
        strict_1.default.equal(restored.status, 404, 'the override is gone; the request reaches the route again');
    });
});
integration('copying permissions gives one user the exact same function-level access as another, and is tenant scoped', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const storeUser = await makeUser(a.companyId, 'STORE_USER', 'store');
    const picker = await makeUser(a.companyId, 'WAREHOUSE_PICKER', 'picker');
    const outsider = await makeUser(b.companyId, 'STORE_USER', 'outsider');
    await withServer(async (call) => {
        const set = await call('PUT', `/users/${storeUser.userId}/permissions`, a.token, {
            permissions: [
                { module: 'TRANSFER', action: 'VIEW', denied: true },
                { module: 'COUNT', action: 'CREATE', allowed: true },
            ],
        });
        strict_1.default.equal(set.status, 200, JSON.stringify(set.body));
        // Cross-tenant: company B's admin cannot reach company A's users at all.
        strict_1.default.equal((await call('POST', `/users/${picker.userId}/permissions/copy-from/${storeUser.userId}`, b.token, {})).status, 404);
        const copy = await call('POST', `/users/${picker.userId}/permissions/copy-from/${storeUser.userId}`, a.token, {});
        strict_1.default.equal(copy.status, 200, JSON.stringify(copy.body));
        strict_1.default.equal(copy.body.permissionCount, 2);
        const pickerPermissions = await call('GET', `/users/${picker.userId}/permissions`, a.token);
        const byKey = new Map(pickerPermissions.body.permissions.map((row) => [`${row.permission.module}:${row.permission.action}`, row]));
        strict_1.default.equal(byKey.get('TRANSFER:VIEW').denied, true);
        strict_1.default.equal(byKey.get('COUNT:CREATE').allowed, true);
        // The outsider (a different company entirely) cannot be used as a copy source across tenants either.
        strict_1.default.equal((await call('POST', `/users/${picker.userId}/permissions/copy-from/${outsider.userId}`, a.token, {})).status, 404);
    });
});
