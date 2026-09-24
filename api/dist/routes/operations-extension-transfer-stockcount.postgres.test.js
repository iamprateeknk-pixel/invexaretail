"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bare-id call-site migration, slice 4 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the Transfer and StockCount call
// sites in routes/operations-extension.ts and routes/catalog-procurement.ts
// fixed to filter by companyId instead of relying on locationId alone (or,
// for the pick-wave lookup, no scoping at all). DB-only - skipped unless
// TEST_DATABASE_URL is set. Reuses the withServer/makeFixture pattern from
// operations-extension-orders.postgres.test.ts (slice 1).
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const operations_extension_js_1 = __importDefault(require("./operations-extension.js"));
const catalog_procurement_js_1 = __importDefault(require("./catalog-procurement.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
function withServer(router) {
    return async (run) => {
        const app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', router);
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
    };
}
const withOpsServer = withServer(operations_extension_js_1.default);
const withCatalogServer = withServer(catalog_procurement_js_1.default);
async function makeFixture() {
    const companyId = `ops-xfer-count-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `ops-xfer-count-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Ops Transfer/Count Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Transfer/Count Test Admin',
        role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
    });
    const locationId = `ops-xfer-count-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
    const destLocationId = `ops-xfer-count-destloc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: destLocationId, code: destLocationId, name: 'Test Dest Loc', type: 'store', companyId } });
    const itemId = `ops-xfer-count-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    return { companyId, userId, locationId, destLocationId, itemId, lotId: lot.id, token };
}
integration('GET /intelligence/:locationId: another company\'s admin sees neither the reorder rule nor the stock-count history behind it, even though the location check itself is bypassed for admins', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    await db_js_1.prisma.reorderRule.create({ data: { itemId: a.itemId, locationId: a.locationId, minQty: 5, targetQty: 20, companyId: a.companyId } });
    await db_js_1.prisma.stockCount.create({
        data: { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, physicalQty: 8, bookQty: 20, submittedById: a.userId, companyId: a.companyId },
    });
    await withOpsServer(async (call) => {
        const cross = await call('GET', `/intelligence/${a.locationId}`, b.token);
        strict_1.default.equal(cross.status, 200, 'the permissive location check still lets an admin of any company through');
        const crossRec = cross.body.intelligence.recommendations.find((r) => r.itemId === a.itemId);
        strict_1.default.equal(crossRec, undefined, 'ReorderRule is now company-scoped too - another company\'s admin must not see this reorder rule at all, not even with a degraded confidence');
        const own = await call('GET', `/intelligence/${a.locationId}`, a.token);
        strict_1.default.equal(own.status, 200);
        const ownRec = own.body.intelligence.recommendations.find((r) => r.itemId === a.itemId);
        strict_1.default.ok(ownRec, 'the owning company must still see its own reorder recommendation');
        strict_1.default.equal(ownRec.confidence, 'MEDIUM', 'the owning company must still see its own stock count variance history reflected in confidence');
    });
});
integration('GET /purchase-orders/plan: another company\'s locationId resolves 404, not a leak of its reorder plan', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    await db_js_1.prisma.reorderRule.create({ data: { itemId: a.itemId, locationId: a.locationId, minQty: 5, targetQty: 20 } });
    await withCatalogServer(async (call) => {
        const cross = await call('GET', `/purchase-orders/plan?locationId=${a.locationId}`, b.token);
        strict_1.default.equal(cross.status, 404, 'a location belonging to another company must look identical to a missing one');
        const own = await call('GET', `/purchase-orders/plan?locationId=${a.locationId}`, a.token);
        strict_1.default.equal(own.status, 200, 'the owning company must still be able to plan for its own location');
    });
});
integration('POST /pick-waves/:id/scan: another company\'s pick wave id resolves 404', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const transfer = await db_js_1.prisma.transfer.create({
        data: {
            sourceLocationId: a.locationId, destinationLocationId: a.destLocationId, requestedById: a.userId,
            status: 'DISPATCHED', companyId: a.companyId,
            lines: { create: [{ itemId: a.itemId, lotId: a.lotId, requestedQty: 5 }] },
        },
    });
    const wave = await db_js_1.prisma.pickWave.create({
        data: { locationId: a.locationId, transferIds: [transfer.id], createdById: a.userId },
    });
    await withOpsServer(async (call) => {
        const cross = await call('POST', `/pick-waves/${wave.id}/scan`, b.token, { scannedBinCode: 'X', walkOrder: [], scannedIndex: 0 });
        strict_1.default.equal(cross.status, 404, 'a pick wave belonging to another company must not be usable, or even discoverable');
    });
});
