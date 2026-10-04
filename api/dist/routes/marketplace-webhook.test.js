"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const express_1 = __importDefault(require("express"));
const marketplace_webhook_js_1 = __importDefault(require("./marketplace-webhook.js"));
const connectors_js_1 = require("../lib/connectors.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const audit_js_1 = require("../lib/audit.js");
// Week 15: the signed marketplace webhook (memory mode). The regression that
// matters most is tenancy: a connector must resolve only ITS OWN company's
// SKUs and locations.
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', marketplace_webhook_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('bind failed');
    const post = async (connectorId, body, secret, badSignature = false) => {
        const raw = JSON.stringify(body);
        const signature = badSignature ? 'sha256=deadbeef' : `sha256=${(0, node_crypto_1.createHmac)('sha256', secret).update(raw).digest('hex')}`;
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/webhooks/marketplaces/${connectorId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Invexa-Signature': signature },
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
        (0, connectors_js_1.resetConnectors)();
    }
}
const orderFor = (ref, sku) => ({ orderId: ref, items: [{ sku, quantity: 1 }] });
(0, node_test_1.default)('an invalid signature is rejected and audited without touching the catalog', async () => {
    await withServer(async (post) => {
        const connector = (0, connectors_js_1.createConnector)({ name: 'FK', platform: 'FLIPKART', webhookSecret: 's3cret', tenantId: tenant_scope_js_1.DEFAULT_COMPANY_ID });
        const res = await post(connector.id, orderFor('FK-1', 'SKU-1001'), 's3cret', true);
        strict_1.default.equal(res.status, 401);
        const audited = (0, audit_js_1.listAuditEvents)().find((e) => e.action === 'CHANNEL_EVENT_REJECTED_SIGNATURE' && e.entityId === connector.id);
        strict_1.default.ok(audited);
        strict_1.default.match(String(audited.metadata?.payloadChecksum), /^[0-9a-f]{64}$/);
    });
});
(0, node_test_1.default)('a connector cannot resolve another company\'s SKU (cross-tenant ingest is a 409, not an order)', async () => {
    await withServer(async (post) => {
        // Jaipur's connector sends the DEFAULT company's SKU (SKU-1001).
        const jaipur = (0, connectors_js_1.createConnector)({ name: 'Jaipur FK', platform: 'FLIPKART', webhookSecret: 'j-secret', tenantId: tenant_scope_js_1.JAIPUR_COMPANY_ID });
        const res = await post(jaipur.id, orderFor('FK-X-1', 'SKU-1001'), 'j-secret');
        strict_1.default.equal(res.status, 409);
        strict_1.default.match(res.body.message, /No matching SKUs/);
        strict_1.default.ok((0, audit_js_1.listAuditEvents)().some((e) => e.action === 'CHANNEL_EVENT_REJECTED_NO_SKU_MATCH' && e.entityId === jaipur.id));
    });
});
(0, node_test_1.default)('the same connector still resolves its own SKU, and a replay is one logical order', async () => {
    await withServer(async (post) => {
        const own = (0, connectors_js_1.createConnector)({ name: 'Own FK', platform: 'FLIPKART', webhookSecret: 'o-secret', tenantId: tenant_scope_js_1.DEFAULT_COMPANY_ID });
        const first = await post(own.id, orderFor('FK-OWN-1', 'SKU-1001'), 'o-secret');
        strict_1.default.equal(first.status, 201, JSON.stringify(first.body));
        const replay = await post(own.id, orderFor('FK-OWN-1', 'SKU-1001'), 'o-secret');
        strict_1.default.equal(replay.status, 200, 'replaying the same marketplace order is a duplicate, not a second order');
        strict_1.default.equal(replay.body.duplicate, true);
        strict_1.default.equal(replay.body.order.id, first.body.order.id);
    });
});
