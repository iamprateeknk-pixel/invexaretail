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
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
function tokenFor(email) {
    const user = (0, enterprise_repository_js_1.findUserByEmail)(email);
    if (!user)
        throw new Error(`missing workspace user ${email}`);
    return (0, otp_auth_js_1.generateJWT)(user.id, user.companyId);
}
async function withServer(run) {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
    if (!(0, enterprise_repository_js_1.findUserByEmail)('admin@jaipur.local')) {
        (0, enterprise_repository_js_1.createEnhancedUser)({
            id: 'user-jaipur-admin',
            companyId: 'company-jaipur',
            email: 'admin@jaipur.local',
            name: 'Jaipur Admin',
            role: 'ADMIN',
            branchIds: [],
            locationIds: ['loc-jaipur-1'],
            passwordHash: (0, otp_auth_js_1.hashPassword)(process.env.SEED_PASSWORD ?? 'ChangeMe123!'),
            status: 'active',
        });
    }
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, tenant_scope_js_1.enforceOperationalCompanyScope, core_js_1.default);
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
async function json(url, path, token) {
    const response = await fetch(`${url}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
}
(0, node_test_1.default)('HTTP: Jaipur admin cannot read grocery locations, items or stock', async () => {
    await withServer(async (url) => {
        const grocery = tokenFor('admin@retail.local');
        const jaipur = tokenFor('admin@jaipur.local');
        const groceryLocations = await json(url, '/api/v1/locations', grocery);
        strict_1.default.equal(groceryLocations.status, 200);
        strict_1.default.equal(groceryLocations.body.locations.some((location) => location.id === 'loc-1'), true);
        strict_1.default.equal(groceryLocations.body.locations.some((location) => location.id === 'loc-jaipur-1'), false);
        const jaipurLocations = await json(url, '/api/v1/locations', jaipur);
        strict_1.default.equal(jaipurLocations.status, 200);
        strict_1.default.equal(jaipurLocations.body.locations.some((location) => location.id === 'loc-1'), false);
        strict_1.default.equal(jaipurLocations.body.locations.some((location) => location.id === 'loc-jaipur-1'), true);
        const groceryItems = await json(url, '/api/v1/items', grocery);
        strict_1.default.equal(groceryItems.body.items.some((item) => item.id === 'item-1001'), true);
        strict_1.default.equal(groceryItems.body.items.some((item) => item.id === 'item-jaipur-1'), false);
        const jaipurItems = await json(url, '/api/v1/items', jaipur);
        strict_1.default.equal(jaipurItems.status, 200);
        strict_1.default.equal(jaipurItems.body.items.some((item) => item.id === 'item-1001'), false);
        strict_1.default.equal(jaipurItems.body.items.some((item) => item.id === 'item-jaipur-1'), true);
        const groceryStock = await json(url, '/api/v1/stock/loc-1', grocery);
        strict_1.default.equal(groceryStock.status, 200);
        const jaipurOwnStock = await json(url, '/api/v1/stock/loc-jaipur-1', jaipur);
        strict_1.default.equal(jaipurOwnStock.status, 200);
        strict_1.default.equal(jaipurOwnStock.body.items.some((row) => row.itemId === 'item-jaipur-1'), true);
        const jaipurStock = await json(url, '/api/v1/stock/loc-1', jaipur);
        strict_1.default.equal(jaipurStock.status, 403);
        strict_1.default.equal(jaipurStock.body.code, 'COMPANY_SCOPE_MISMATCH');
    });
});
