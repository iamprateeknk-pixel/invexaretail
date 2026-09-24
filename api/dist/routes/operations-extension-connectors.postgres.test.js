"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bare-id call-site migration, slice 6 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the MarketplaceConnector/Item call
// sites in routes/operations-extension.ts's POST /connectors/:id/ingest,
// found while fixing the Item bare-id call sites in this file. DB-only -
// skipped unless TEST_DATABASE_URL is set.
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
    const companyId = `ops-connector-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `ops-connector-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Ops Connector Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Connector Test Admin',
        role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
    });
    const locationId = `ops-connector-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId, status: 'ACTIVE' } });
    const itemId = `ops-connector-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    return { companyId, userId, locationId, itemId, token };
}
integration('POST /connectors/:id/ingest: another company\'s connector id resolves 404', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const connector = await db_js_1.prisma.marketplaceConnector.create({
        data: { name: 'Test Connector', platform: 'CUSTOM', channel: 'web', webhookSecret: 'whsec_test', tenantId: a.companyId },
    });
    await withServer(async (call) => {
        const cross = await call('POST', `/connectors/${connector.id}/ingest`, b.token, { externalReference: (0, node_crypto_1.randomUUID)(), lines: [{ sku: a.itemId, quantity: 1 }] });
        strict_1.default.equal(cross.status, 404, 'a connector belonging to another company must not be usable, or even discoverable');
    });
});
integration('POST /connectors/:id/ingest: a SKU that resolves to another company\'s item is rejected as unknown, not silently used', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const connector = await db_js_1.prisma.marketplaceConnector.create({
        data: { name: 'Test Connector', platform: 'CUSTOM', channel: 'web', webhookSecret: 'whsec_test', tenantId: a.companyId },
    });
    await withServer(async (call) => {
        const response = await call('POST', `/connectors/${connector.id}/ingest`, a.token, { externalReference: (0, node_crypto_1.randomUUID)(), lines: [{ sku: b.itemId, quantity: 1 }] });
        strict_1.default.equal(response.status, 409, 'no order can be created when every line references an unknown SKU');
        strict_1.default.equal(response.body.orders.length, 0);
        strict_1.default.ok(response.body.errors.some((e) => e.message.includes('Unknown SKU')), 'another company\'s item id must resolve as an unknown SKU, not a usable one');
    });
});
