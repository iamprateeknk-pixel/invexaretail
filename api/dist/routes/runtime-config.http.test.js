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
    app.use('/api/v1', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, tenant_scope_js_1.enforceOperationalCompanyScope);
    app.use('/api/v1', core_js_1.default);
    app.use('/control/v1', control_plane_js_1.controlRouter);
    app.use('/studio/v1', control_plane_js_1.studioRouter);
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
(0, node_test_1.default)('HTTP: runtime config is authenticated, company-scoped, and follows Studio publish', async () => {
    await withServer(async (url) => {
        const anonymous = await json(url, '/api/v1/runtime/config');
        strict_1.default.equal(anonymous.status, 401);
        const grocery = tokenFor('admin@retail.local');
        const storeUser = (0, enterprise_repository_js_1.findUserByEmail)('store@retail.local');
        const storeToken = storeUser ? (0, otp_auth_js_1.generateJWT)(storeUser.id, storeUser.companyId) : grocery;
        const before = await json(url, '/api/v1/runtime/config', { headers: { Authorization: `Bearer ${grocery}` } });
        strict_1.default.equal(before.status, 200);
        strict_1.default.equal(before.body.runtime.companyId, 'default-company');
        strict_1.default.equal(before.body.runtime.page.actions.some((action) => action.key === 'export' && action.enabled !== false), true);
        const login = await json(url, '/control/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
        });
        const groceryLock = await json(url, '/control/v1/sessions/select-company', {
            method: 'POST',
            headers: { Authorization: `Bearer ${login.body.token}` },
            body: JSON.stringify({ companyId: 'default-company' }),
        });
        const studioAuth = { Authorization: `Bearer ${groceryLock.body.token}` };
        const previousVersion = before.body.runtime.version;
        const columnKey = `runtime_min_${Date.now().toString(36)}`;
        const column = await json(url, '/studio/v1/draft/stock/columns', {
            method: 'POST',
            headers: studioAuth,
            body: JSON.stringify({ name: 'Minimum Stock', key: columnKey, type: 'number' }),
        });
        strict_1.default.equal(column.status, 200);
        const disabled = await json(url, '/studio/v1/draft/actions/export', {
            method: 'POST',
            headers: studioAuth,
            body: JSON.stringify({ enabled: false }),
        });
        strict_1.default.equal(disabled.status, 200);
        const published = await json(url, '/studio/v1/publish', { method: 'POST', headers: studioAuth });
        strict_1.default.equal(published.status, 200);
        try {
            const after = await json(url, '/api/v1/runtime/config', { headers: { Authorization: `Bearer ${grocery}` } });
            strict_1.default.equal(after.status, 200);
            strict_1.default.equal(after.body.runtime.page.columns.some((entry) => entry.key === columnKey), true);
            strict_1.default.equal(after.body.runtime.page.actions.some((action) => action.key === 'export'), false);
            if (storeUser) {
                const storeRuntime = await json(url, '/api/v1/runtime/config', { headers: { Authorization: `Bearer ${storeToken}` } });
                strict_1.default.equal(storeRuntime.status, 200);
                strict_1.default.equal(storeRuntime.body.runtime.page.columns.some((entry) => entry.key === columnKey), false);
            }
            const jaipur = tokenFor('admin@jaipur.local');
            const jaipurRuntime = await json(url, '/api/v1/runtime/config', { headers: { Authorization: `Bearer ${jaipur}` } });
            strict_1.default.equal(jaipurRuntime.status, 200);
            strict_1.default.equal(jaipurRuntime.body.runtime.companyId, 'company-jaipur');
            strict_1.default.equal(jaipurRuntime.body.runtime.page.columns.some((entry) => entry.key === columnKey), false);
        }
        finally {
            const restored = await json(url, '/studio/v1/rollback', {
                method: 'POST',
                headers: studioAuth,
                body: JSON.stringify({ version: previousVersion }),
            });
            strict_1.default.equal(restored.status, 200);
        }
    });
});
