"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bare-id call-site migration, slice 1 (see docs/week23-order-bare-id-
// remediation.md): HTTP-level cross-tenant coverage for the Order routes
// in routes/operations-extension.ts that were fixed to filter by companyId
// instead of looking a row up by bare id alone. DB-only (Order.companyId
// is a real Postgres column, invisible in memory mode) - skipped unless
// TEST_DATABASE_URL is set. This harness (withServer/makeFixture) is meant
// to be reused, not rewritten, by the next slice of this same
// remediation - see AGENTS.md "Required tests".
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const operations_extension_js_1 = __importDefault(require("./operations-extension.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // operationsExtensionRouter applies its own extractToken/requireAuth/
    // enforcePermissionOverrides internally - no external auth middleware
    // needed here, matching how the router is actually mounted in index.ts.
    app.use('/api/v1', operations_extension_js_1.default);
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
    const companyId = `ops-orders-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `ops-orders-user-${(0, node_crypto_1.randomUUID)()}`;
    // Order.createdById is a real FK to User - a Postgres row is required
    // even though auth itself (requireAuth) checks the separate in-memory
    // enhanced-user store below, not this table.
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Ops Orders Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Orders Test Admin',
        role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
    });
    const locationId = `ops-orders-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    return { companyId, userId, locationId, token };
}
async function makeOrder(companyId, locationId, createdById) {
    return db_js_1.prisma.order.create({
        data: { channel: 'web', fulfillmentLocationId: locationId, createdById, companyId, status: 'RESERVED' },
    });
}
integration('GET /orders/:id/pack: another company\'s order id resolves 404, not 403, and never leaks its existence', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
    await withServer(async (call) => {
        const cross = await call('GET', `/orders/${orderA.id}/pack`, b.token);
        strict_1.default.equal(cross.status, 404, 'a real order belonging to another company must look identical to a missing one');
        const own = await call('GET', `/orders/${orderA.id}/pack`, a.token);
        strict_1.default.equal(own.status, 200, 'the owning company must still be able to read its own order');
        strict_1.default.equal(own.body.session, null);
    });
});
integration('GET /orders/:id/shipment: cross-tenant lookup is scoped by companyId, not by location', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
    await withServer(async (call) => {
        const cross = await call('GET', `/orders/${orderA.id}/shipment`, b.token);
        strict_1.default.equal(cross.status, 404);
        const own = await call('GET', `/orders/${orderA.id}/shipment`, a.token);
        strict_1.default.equal(own.status, 200);
    });
});
integration('GET /orders/:id/returns: cross-tenant lookup is scoped by companyId', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
    await withServer(async (call) => {
        const cross = await call('GET', `/orders/${orderA.id}/returns`, b.token);
        strict_1.default.equal(cross.status, 404);
        const own = await call('GET', `/orders/${orderA.id}/returns`, a.token);
        strict_1.default.equal(own.status, 200);
    });
});
integration('GET /orders: the list endpoint only ever returns the caller\'s own company\'s orders', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
    const orderB = await makeOrder(b.companyId, b.locationId, b.userId);
    await withServer(async (call) => {
        const listA = await call('GET', '/orders', a.token);
        strict_1.default.equal(listA.status, 200);
        const idsA = listA.body.orders.map((o) => o.id);
        strict_1.default.ok(idsA.includes(orderA.id), 'company A must see its own order');
        strict_1.default.ok(!idsA.includes(orderB.id), 'company A must not see company B\'s order');
    });
});
integration('POST /shipments/:awb/cancel: a shipment belonging to another company is not found', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
    const awbNumber = `AWB-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    await db_js_1.prisma.shipment.create({
        data: {
            orderId: orderA.id, awbNumber, carrierProvider: 'MANUAL', serviceCode: 'STD', status: 'BOOKED',
            createdById: a.userId, companyId: a.companyId,
        },
    });
    await withServer(async (call) => {
        const cross = await call('POST', `/shipments/${awbNumber}/cancel`, b.token);
        strict_1.default.equal(cross.status, 404, 'a shipment belonging to another company must not be cancellable, or even discoverable');
    });
});
