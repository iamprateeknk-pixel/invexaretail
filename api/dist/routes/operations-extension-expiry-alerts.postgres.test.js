"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bare-id call-site migration, slice 7 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the ExpiryAlert routes in
// routes/operations-extension.ts fixed to filter by companyId instead of
// looking a row up by bare id alone. DB-only - skipped unless
// TEST_DATABASE_URL is set. Reuses the withServer/makeFixture pattern from
// operations-extension-orders.postgres.test.ts.
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
    const companyId = `ops-expiry-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `ops-expiry-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Ops Expiry Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Expiry Test Admin',
        role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
    });
    const locationId = `ops-expiry-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
    const itemId = `ops-expiry-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    return { companyId, userId, locationId, itemId, lotId: lot.id, token };
}
async function makeAlert(a) {
    return db_js_1.prisma.expiryAlert.create({
        data: {
            itemId: a.itemId, lotId: a.lotId, locationId: a.locationId,
            quantity: 10, expiryDate: new Date(Date.now() + 30 * 86_400_000), daysUntilExpiry: 30,
            companyId: a.companyId,
        },
    });
}
integration('PATCH /expiry-alerts/:id/status: another company\'s expiry alert id resolves 404, not a status change', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const alert = await makeAlert(a);
    await withServer(async (call) => {
        const cross = await call('PATCH', `/expiry-alerts/${alert.id}/status`, b.token, { status: 'ACKNOWLEDGED' });
        strict_1.default.equal(cross.status, 404, 'a real expiry alert belonging to another company must look identical to a missing one');
        const unchanged = await db_js_1.prisma.expiryAlert.findUniqueOrThrow({ where: { id: alert.id } });
        strict_1.default.equal(unchanged.status, 'ACTIVE', 'the cross-tenant attempt must not have changed anything');
        const own = await call('PATCH', `/expiry-alerts/${alert.id}/status`, a.token, { status: 'ACKNOWLEDGED' });
        strict_1.default.equal(own.status, 200, 'the owning company must still be able to act on its own alert');
    });
});
integration('POST /expiry-alerts/:id/write-off: another company\'s expiry alert id resolves 404, not a write-off', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const alert = await makeAlert(a);
    await db_js_1.prisma.stockLedger.create({ data: { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, onHand: 10, companyId: a.companyId } });
    await withServer(async (call) => {
        const cross = await call('POST', `/expiry-alerts/${alert.id}/write-off`, b.token, { reason: 'Cross tenant write off attempt' });
        strict_1.default.equal(cross.status, 404);
        const unchanged = await db_js_1.prisma.expiryAlert.findUniqueOrThrow({ where: { id: alert.id } });
        strict_1.default.equal(unchanged.status, 'ACTIVE', 'the cross-tenant attempt must not have changed anything');
    });
});
