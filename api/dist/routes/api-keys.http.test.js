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
const control_plane_js_1 = require("./control-plane.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const entitlements_js_1 = require("../lib/saas/entitlements.js");
const control_plane_js_2 = require("../lib/saas/control-plane.js");
const seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
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
(0, node_test_1.default)('read scopes allow GET and write scopes are required to mutate', () => {
    strict_1.default.equal((0, control_plane_js_2.apiKeyAllowsMethod)(['inventory.read'], 'GET'), true);
    strict_1.default.equal((0, control_plane_js_2.apiKeyAllowsMethod)(['inventory.read'], 'POST'), false);
    strict_1.default.equal((0, control_plane_js_2.apiKeyAllowsMethod)(['inventory.write'], 'GET'), true);
    strict_1.default.equal((0, control_plane_js_2.apiKeyAllowsMethod)(['inventory.write'], 'POST'), true);
});
(0, node_test_1.default)('HTTP: Pro API keys authenticate /api/v1 and Starter cannot issue keys', async () => {
    await withServer(async (url) => {
        const login = await json(url, '/control/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
        });
        const groceryLock = await json(url, '/control/v1/sessions/select-company', {
            method: 'POST',
            headers: { Authorization: `Bearer ${login.body.token}` },
            body: JSON.stringify({ companyId: 'default-company' }),
        });
        const groceryAuth = { Authorization: `Bearer ${groceryLock.body.token}` };
        const created = await json(url, '/control/v1/integrations/api-keys', {
            method: 'POST',
            headers: groceryAuth,
            body: JSON.stringify({ name: 'POS', scopes: ['inventory.read'] }),
        });
        strict_1.default.equal(created.status, 201);
        strict_1.default.match(created.body.token, /^invx_/);
        const token = created.body.token;
        const listed = await json(url, '/api/v1/items', { headers: { Authorization: `Bearer ${token}` } });
        strict_1.default.equal(listed.status, 200);
        strict_1.default.equal(Array.isArray(listed.body.items), true);
        const writeDenied = await json(url, '/api/v1/items', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ code: `SKU-KEY-${Date.now()}`, name: 'Key snack', unit: 'pack' }),
        });
        strict_1.default.equal(writeDenied.status, 403);
        strict_1.default.equal(writeDenied.body.code, 'API_KEY_SCOPE');
        const invalid = await json(url, '/api/v1/items', { headers: { Authorization: 'Bearer invx_deadbeefdeadbeefdeadbeefdeadbeef' } });
        strict_1.default.equal(invalid.status, 401);
        strict_1.default.equal(invalid.body.code, 'API_KEY_INVALID');
        const revoked = await json(url, `/control/v1/integrations/api-keys/${created.body.id}/revoke`, {
            method: 'POST',
            headers: groceryAuth,
        });
        strict_1.default.equal(revoked.status, 200);
        strict_1.default.equal(revoked.body.apiKey.status, 'revoked');
        const afterRevoke = await json(url, '/api/v1/items', { headers: { Authorization: `Bearer ${token}` } });
        strict_1.default.equal(afterRevoke.status, 401);
        strict_1.default.equal(afterRevoke.body.code, 'API_KEY_REVOKED');
        const jaipurLock = await json(url, '/control/v1/sessions/select-company', {
            method: 'POST',
            headers: { Authorization: `Bearer ${login.body.token}` },
            body: JSON.stringify({ companyId: 'company-jaipur' }),
        });
        const jaipurKey = await json(url, '/control/v1/integrations/api-keys', {
            method: 'POST',
            headers: { Authorization: `Bearer ${jaipurLock.body.token}` },
            body: JSON.stringify({ name: 'POS', scopes: ['inventory.read'] }),
        });
        strict_1.default.equal(jaipurKey.status, 403);
        strict_1.default.equal(jaipurKey.body.code, 'FEATURE_NOT_ENTITLED');
    });
});
