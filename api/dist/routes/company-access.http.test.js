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
const company_access_js_1 = require("../lib/saas/company-access.js");
const control_plane_js_2 = require("../lib/saas/control-plane.js");
const tenant_scope_js_2 = require("../lib/saas/tenant-scope.js");
const repository_js_1 = require("../lib/repository.js");
const seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
function tokenFor(email) {
    const user = (0, enterprise_repository_js_1.findUserByEmail)(email);
    if (!user)
        throw new Error(`missing workspace user ${email}`);
    return (0, otp_auth_js_1.generateJWT)(user.id, user.companyId);
}
async function withServer(run) {
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
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope, company_access_js_1.enforceSuspendedCompany, company_access_js_1.enforcePlanLimits, company_access_js_1.enforceApiUsage);
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
(0, node_test_1.default)('HTTP: suspending a company freezes tenant reads, writes and password login', async () => {
    const platform = control_plane_js_2.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    try {
        await withServer(async (url) => {
            const login = await json(url, '/control/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
            });
            strict_1.default.equal(login.status, 200);
            const platformToken = login.body.token;
            const groceryToken = tokenFor('admin@retail.local');
            const before = await json(url, '/api/v1/locations', {
                headers: { Authorization: `Bearer ${groceryToken}` },
            });
            strict_1.default.equal(before.status, 200);
            const suspended = await json(url, '/control/v1/companies/default-company/suspend', {
                method: 'POST',
                headers: { Authorization: `Bearer ${platformToken}` },
                body: JSON.stringify({ reason: 'http-test' }),
            });
            strict_1.default.equal(suspended.status, 200);
            strict_1.default.equal(suspended.body.company.status, 'suspended');
            const frozen = await json(url, '/api/v1/locations', {
                headers: { Authorization: `Bearer ${groceryToken}` },
            });
            strict_1.default.equal(frozen.status, 403);
            strict_1.default.equal(frozen.body.code, 'COMPANY_SUSPENDED');
            const tenantLogin = await json(url, '/api/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: 'admin@retail.local', password: seedPassword }),
            });
            strict_1.default.equal(tenantLogin.status, 403);
            strict_1.default.equal(tenantLogin.body.code, 'COMPANY_SUSPENDED');
            const jaipur = tokenFor('admin@jaipur.local');
            const otherTenant = await json(url, '/api/v1/locations', {
                headers: { Authorization: `Bearer ${jaipur}` },
            });
            strict_1.default.equal(otherTenant.status, 200);
            const activated = await json(url, '/control/v1/companies/default-company/activate', {
                method: 'POST',
                headers: { Authorization: `Bearer ${platformToken}` },
                body: JSON.stringify({ reason: 'http-test-restore' }),
            });
            strict_1.default.equal(activated.status, 200);
            strict_1.default.equal(activated.body.company.status, 'active');
            const restored = await json(url, '/api/v1/locations', {
                headers: { Authorization: `Bearer ${groceryToken}` },
            });
            strict_1.default.equal(restored.status, 200);
            const restoredLogin = await json(url, '/api/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: 'admin@retail.local', password: seedPassword }),
            });
            strict_1.default.equal(restoredLogin.status, 200);
            strict_1.default.equal(restoredLogin.body.success, true);
        });
    }
    finally {
        control_plane_js_2.controlPlane.setCompanyStatus(platform, 'default-company', 'active', 'http-test-restore');
    }
});
(0, node_test_1.default)('HTTP: plan limits block new grocery items at the current catalog size', async () => {
    const previous = control_plane_js_2.controlPlane.limitOverrides.get('default-company');
    const current = (0, tenant_scope_js_2.itemsForCompany)('default-company', (0, repository_js_1.listItems)()).length;
    control_plane_js_2.controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), max_items: current });
    try {
        await withServer(async (url) => {
            const grocery = tokenFor('admin@retail.local');
            const created = await json(url, '/api/v1/items', {
                method: 'POST',
                headers: { Authorization: `Bearer ${grocery}` },
                body: JSON.stringify({ code: `SKU-LIMIT-${Date.now()}`, name: 'Limit snack', unit: 'pack' }),
            });
            strict_1.default.equal(created.status, 403);
            strict_1.default.equal(created.body.code, 'PLAN_LIMIT_REACHED');
            const listed = await json(url, '/api/v1/items', {
                headers: { Authorization: `Bearer ${grocery}` },
            });
            strict_1.default.equal(listed.status, 200);
            strict_1.default.equal(Array.isArray(listed.body.items), true);
        });
    }
    finally {
        if (previous)
            control_plane_js_2.controlPlane.limitOverrides.set('default-company', previous);
        else
            control_plane_js_2.controlPlane.limitOverrides.delete('default-company');
    }
});
(0, node_test_1.default)('HTTP: daily API usage cap returns 429 USAGE_LIMIT_REACHED', async () => {
    const previous = control_plane_js_2.controlPlane.limitOverrides.get('default-company');
    const previousUsage = control_plane_js_2.controlPlane.usage.get('default-company');
    control_plane_js_2.controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), api_requests_per_day: 0 });
    try {
        await withServer(async (url) => {
            const grocery = tokenFor('admin@retail.local');
            const listed = await json(url, '/api/v1/locations', {
                headers: { Authorization: `Bearer ${grocery}` },
            });
            strict_1.default.equal(listed.status, 429);
            strict_1.default.equal(listed.body.code, 'USAGE_LIMIT_REACHED');
            const tenantLogin = await json(url, '/api/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: 'admin@retail.local', password: seedPassword }),
            });
            strict_1.default.equal(tenantLogin.status, 200);
            strict_1.default.equal(tenantLogin.body.success, true);
        });
    }
    finally {
        if (previous)
            control_plane_js_2.controlPlane.limitOverrides.set('default-company', previous);
        else
            control_plane_js_2.controlPlane.limitOverrides.delete('default-company');
        if (previousUsage)
            control_plane_js_2.controlPlane.usage.set('default-company', previousUsage);
        else
            control_plane_js_2.controlPlane.usage.delete('default-company');
    }
});
