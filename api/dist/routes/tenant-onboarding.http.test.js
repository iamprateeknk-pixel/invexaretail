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
const enterprise_auth_js_2 = __importDefault(require("./enterprise-auth.js"));
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
async function withServer(run) {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(seedPassword));
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
    app.use('/api/v1/auth', enterprise_auth_js_2.default);
    app.use('/api/v1', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, core_js_1.default);
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
(0, node_test_1.default)('HTTP: Super Admin onboarding creates an isolated operational tenant', async () => {
    await withServer(async (url) => {
        const login = await json(url, '/control/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
        });
        strict_1.default.equal(login.status, 200);
        const platformToken = login.body.token;
        const locked = await json(url, '/control/v1/sessions/select-company', {
            method: 'POST',
            headers: { Authorization: `Bearer ${platformToken}` },
            body: JSON.stringify({ companyId: 'default-company' }),
        });
        const forbidden = await json(url, '/control/v1/companies', {
            method: 'POST',
            headers: { Authorization: `Bearer ${locked.body.token}` },
            body: JSON.stringify({ name: 'Should Fail', planId: 'starter', adminEmail: 'fail@x.local', adminName: 'Fail' }),
        });
        strict_1.default.equal(forbidden.status, 401);
        strict_1.default.equal(forbidden.body.code, 'SESSION_REQUIRED');
        const stamp = Date.now();
        const email = `admin@kota-${stamp}.local`;
        const created = await json(url, '/control/v1/companies', {
            method: 'POST',
            headers: { Authorization: `Bearer ${platformToken}` },
            body: JSON.stringify({
                name: 'Kota Fresh Mart',
                planId: 'starter',
                adminEmail: email,
                adminName: 'Kota Admin',
            }),
        });
        strict_1.default.equal(created.status, 201);
        strict_1.default.equal(created.body.company.name, 'Kota Fresh Mart');
        strict_1.default.equal(created.body.company.status, 'active');
        strict_1.default.equal(created.body.admin.email, email);
        strict_1.default.match(String(created.body.admin.temporaryPassword), /^Invexa/);
        strict_1.default.equal(created.body.location.type, 'store');
        const tenantLogin = await json(url, '/api/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password: created.body.admin.temporaryPassword }),
        });
        strict_1.default.equal(tenantLogin.status, 200);
        strict_1.default.equal(tenantLogin.body.user.companyId, created.body.company.id);
        const tenantToken = tenantLogin.body.token;
        const tenantLocations = await json(url, '/api/v1/locations', {
            headers: { Authorization: `Bearer ${tenantToken}` },
        });
        strict_1.default.equal(tenantLocations.status, 200);
        strict_1.default.equal(tenantLocations.body.locations.length, 1);
        strict_1.default.equal(tenantLocations.body.locations[0].id, created.body.location.id);
        strict_1.default.equal(tenantLocations.body.locations.some((row) => row.id === 'loc-1'), false);
        const grocery = tokenFor('admin@retail.local');
        const groceryLocations = await json(url, '/api/v1/locations', {
            headers: { Authorization: `Bearer ${grocery}` },
        });
        strict_1.default.equal(groceryLocations.status, 200);
        strict_1.default.equal(groceryLocations.body.locations.some((row) => row.id === created.body.location.id), false);
    });
});
