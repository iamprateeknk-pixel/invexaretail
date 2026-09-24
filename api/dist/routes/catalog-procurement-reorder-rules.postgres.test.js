"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bare-id call-site migration, slice 7 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the ReorderRule routes in
// routes/catalog-procurement.ts. ReorderRule had no companyId column at
// all before this slice - migration 20261102090000_reorder_rule_company_scope
// adds one, backfilled through the rule's own Location. DB-only - skipped
// unless TEST_DATABASE_URL is set. Reuses the withServer/makeFixture
// pattern from operations-extension-orders.postgres.test.ts.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const catalog_procurement_js_1 = __importDefault(require("./catalog-procurement.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', catalog_procurement_js_1.default);
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
async function makeFixture() {
    const companyId = `catalog-reorder-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `catalog-reorder-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Catalog Reorder Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Catalog Reorder Test Admin',
        role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
    });
    const locationId = `catalog-reorder-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
    const itemId = `catalog-reorder-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    return { companyId, userId, locationId, itemId, token };
}
integration('GET /reorder-rules: only ever returns the caller\'s own company\'s rules for a location it does not own', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const ruleA = await db_js_1.prisma.reorderRule.create({ data: { itemId: a.itemId, locationId: a.locationId, minQty: 5, targetQty: 20, companyId: a.companyId } });
    await withServer(async (call) => {
        const cross = await call('GET', `/reorder-rules?locationId=${a.locationId}`, b.token);
        strict_1.default.equal(cross.status, 200, 'the permissive role-only check still lets an admin of any company through');
        strict_1.default.deepEqual(cross.body.rules, [], 'another company\'s admin must not see a rule for a location it does not own');
        const own = await call('GET', `/reorder-rules?locationId=${a.locationId}`, a.token);
        strict_1.default.equal(own.status, 200);
        strict_1.default.ok(own.body.rules.some((r) => r.id === ruleA.id));
    });
});
integration('PUT /reorder-rules/:itemId: another company\'s locationId is rejected, not silently written to', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    await withServer(async (call) => {
        const cross = await call('PUT', `/reorder-rules/${a.itemId}`, b.token, { locationId: a.locationId, minQty: 1, targetQty: 10 });
        strict_1.default.equal(cross.status, 404, 'a location belonging to another company must not be usable to create or update a reorder rule');
        const rule = await db_js_1.prisma.reorderRule.findUnique({ where: { itemId_locationId: { itemId: a.itemId, locationId: a.locationId } } });
        strict_1.default.equal(rule, null, 'the cross-tenant attempt must not have created a rule at all');
        const own = await call('PUT', `/reorder-rules/${a.itemId}`, a.token, { locationId: a.locationId, minQty: 1, targetQty: 10 });
        strict_1.default.equal(own.status, 200, 'the owning company\'s own write must still succeed');
        strict_1.default.equal(own.body.rule.companyId, a.companyId, 'a newly created rule must be stamped with the caller\'s real companyId');
    });
});
integration('GET /purchase-orders/plan: reorder rules from another company at the same item never leak into the plan', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    await db_js_1.prisma.reorderRule.create({ data: { itemId: a.itemId, locationId: a.locationId, minQty: 5, targetQty: 20, companyId: a.companyId } });
    await withServer(async (call) => {
        const cross = await call('GET', `/purchase-orders/plan?locationId=${a.locationId}`, b.token);
        strict_1.default.equal(cross.status, 404);
    });
});
