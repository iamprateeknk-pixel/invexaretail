"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Guide Week 15 against real Postgres: the durable webhook event log makes a
// replay one logical order, records provider event -> order, and a delivery
// from one company's connector cannot resolve another company's SKUs.
// Skipped unless TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const express_1 = __importDefault(require("express"));
const db_js_1 = require("../lib/db.js");
const marketplace_webhook_js_1 = __importDefault(require("./marketplace-webhook.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', marketplace_webhook_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('bind failed');
    const post = async (connectorId, body, secret, headers = {}) => {
        const raw = JSON.stringify(body);
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/webhooks/marketplaces/${connectorId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Invexa-Signature': `sha256=${(0, node_crypto_1.createHmac)('sha256', secret).update(raw).digest('hex')}`, ...headers },
            body: raw,
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    try {
        await run(post);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
async function makeCompany(stock = 10) {
    const companyId = `mkt-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const loc = await db_js_1.prisma.location.create({ data: { id: `mkt-loc-${(0, node_crypto_1.randomUUID)()}`, code: `mkt-${(0, node_crypto_1.randomUUID)()}`, name: 'Hub', type: 'warehouse', companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `MKT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Mkt item', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: loc.id, onHand: stock, companyId } });
    const secret = `secret-${(0, node_crypto_1.randomUUID)()}`;
    const connector = await db_js_1.prisma.marketplaceConnector.create({ data: { name: 'FK', platform: 'FLIPKART', channel: 'FLIPKART', webhookSecret: secret, tenantId: companyId } });
    return { companyId, loc, item, lot, secret, connector };
}
const order = (ref, sku) => ({ orderId: ref, items: [{ sku, quantity: 2 }] });
integration('a replayed delivery is one order, one reservation, and the event log ties event to order', async () => {
    const a = await makeCompany(10);
    const ref = `FK-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    await withServer(async (post) => {
        const first = await post(a.connector.id, order(ref, a.item.code), a.secret);
        strict_1.default.equal(first.status, 201, JSON.stringify(first.body));
        const replay = await post(a.connector.id, order(ref, a.item.code), a.secret);
        strict_1.default.equal(replay.status, 200);
        strict_1.default.equal(replay.body.duplicate, true);
        strict_1.default.equal(replay.body.order.id, first.body.order.id);
    });
    strict_1.default.equal(await db_js_1.prisma.order.count({ where: { externalReference: ref, companyId: a.companyId } }), 1);
    const ledger = await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: a.item.id } });
    strict_1.default.equal(ledger.reserved, 2, 'reserved exactly once');
    const events = await db_js_1.prisma.channelWebhookEvent.findMany({ where: { connectorId: a.connector.id } });
    strict_1.default.equal(events.length, 1);
    strict_1.default.equal(events[0].state, 'PROCESSED');
    strict_1.default.equal(events[0].eventId, ref);
    strict_1.default.equal(events[0].companyId, a.companyId);
    strict_1.default.match(events[0].payloadChecksum, /^[0-9a-f]{64}$/);
    strict_1.default.ok(events[0].orderId);
});
integration('an explicit X-Invexa-Event-Id is the dedupe key', async () => {
    const a = await makeCompany(10);
    await withServer(async (post) => {
        const eventId = `evt-${(0, node_crypto_1.randomUUID)()}`;
        const first = await post(a.connector.id, order(`FK-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, a.item.code), a.secret, { 'X-Invexa-Event-Id': eventId });
        strict_1.default.equal(first.status, 201);
        // Same event id redelivered with a different order reference is still the same event.
        const again = await post(a.connector.id, order(`FK-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, a.item.code), a.secret, { 'X-Invexa-Event-Id': eventId });
        strict_1.default.equal(again.status, 200);
        strict_1.default.equal(again.body.duplicate, true);
    });
    strict_1.default.equal(await db_js_1.prisma.order.count({ where: { companyId: a.companyId } }), 1);
});
integration('a rejected delivery (unknown SKU) is logged REJECTED and can be retried once the SKU exists', async () => {
    const a = await makeCompany(10);
    const ref = `FK-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    await withServer(async (post) => {
        const bad = await post(a.connector.id, order(ref, 'NO-SUCH-SKU'), a.secret);
        strict_1.default.equal(bad.status, 409);
        strict_1.default.equal((await db_js_1.prisma.channelWebhookEvent.findFirstOrThrow({ where: { connectorId: a.connector.id } })).state, 'REJECTED');
        const ok = await post(a.connector.id, order(ref, a.item.code), a.secret);
        strict_1.default.equal(ok.status, 201);
    });
    strict_1.default.equal((await db_js_1.prisma.channelWebhookEvent.findFirstOrThrow({ where: { connectorId: a.connector.id } })).state, 'PROCESSED');
});
integration('company B\'s connector cannot resolve company A\'s SKU or reserve A\'s stock', async () => {
    const a = await makeCompany(10);
    const b = await makeCompany(10);
    await withServer(async (post) => {
        const res = await post(b.connector.id, order(`FK-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, a.item.code), b.secret);
        strict_1.default.equal(res.status, 409);
    });
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: a.item.id } })).reserved, 0);
    strict_1.default.equal(await db_js_1.prisma.order.count({ where: { companyId: b.companyId } }), 0);
});
