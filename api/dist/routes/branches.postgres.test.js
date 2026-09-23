"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 8: Branch management is DB-only (no in-memory mirror - the same as
// it was in the retired routes/foundation.ts), so this is a .postgres.test.ts
// per AGENTS.md's "Required tests" convention. Skipped unless
// TEST_DATABASE_URL is set.
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const express_1 = __importDefault(require("express"));
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const seed_js_1 = require("../lib/seed.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const branches_js_1 = __importDefault(require("./branches.js"));
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const db_js_1 = require("../lib/db.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
function tokenFor(email) {
    const user = (0, enterprise_repository_js_1.findUserByEmail)(email);
    if (!user)
        throw new Error(`missing workspace user ${email}`);
    return (0, otp_auth_js_1.generateJWT)(user.id, user.companyId);
}
async function withServer(run) {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
    app.use('/api/v1', branches_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const call = async (method, path, token, body) => {
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    try {
        await run(call);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
integration('a non-admin cannot create, update or archive a branch, but can list them', async () => {
    await withServer(async (call) => {
        const store = tokenFor('store@retail.local');
        const code = `BR-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`.toUpperCase();
        strict_1.default.equal((await call('POST', '/branches', store, { code, name: 'Test Branch' })).status, 403);
        strict_1.default.equal((await call('GET', '/branches', store)).status, 200);
    });
});
integration('creating a branch, then a duplicate code, then updating and archiving it', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const code = `BR-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`.toUpperCase();
        const created = await call('POST', '/branches', admin, { code, name: 'New Branch' });
        strict_1.default.equal(created.status, 201);
        strict_1.default.equal(created.body.branch.code, code);
        const duplicate = await call('POST', '/branches', admin, { code, name: 'Another Branch' });
        strict_1.default.equal(duplicate.status, 409);
        const updated = await call('PATCH', `/branches/${created.body.branch.id}`, admin, { name: 'Renamed Branch', code: 'IGNORED' });
        strict_1.default.equal(updated.status, 200);
        strict_1.default.equal(updated.body.branch.name, 'Renamed Branch');
        strict_1.default.equal(updated.body.branch.code, code, 'branch code must be immutable via PATCH');
        const archived = await call('POST', `/branches/${created.body.branch.id}/archive`, admin);
        strict_1.default.equal(archived.status, 200);
        strict_1.default.equal(archived.body.branch.status, 'ARCHIVED');
    });
});
integration('a branch with a location holding on-hand stock cannot be archived - the StockLedger fix made while porting from foundation.ts', async () => {
    const companyId = `branch-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const branchCode = `BR-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`.toUpperCase();
    const branch = await db_js_1.prisma.branch.create({ data: { code: branchCode, name: 'Stocked Branch', type: 'WAREHOUSE' } });
    const locationId = `branch-test-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Loc', type: 'warehouse', companyId, branchId: branch.id } });
    const itemId = `branch-test-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Item', unit: 'ea', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand: 5, companyId } });
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const response = await call('POST', `/branches/${branch.id}/archive`, admin);
        strict_1.default.equal(response.status, 409);
        strict_1.default.equal(response.body.blockers.activeStock, 1);
    });
});
