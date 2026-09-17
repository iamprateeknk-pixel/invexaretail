"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const reorder_store_js_1 = require("./reorder-store.js");
const repository_js_1 = require("./repository.js");
const webhook_dispatcher_js_1 = require("./webhook-dispatcher.js");
const webhook_events_js_1 = require("./webhook-events.js");
const webhook_store_js_1 = require("./webhook-store.js");
const control_plane_js_1 = require("./saas/control-plane.js");
(0, node_test_1.default)('subscriptions hide signing secrets and pause skips delivery', async () => {
    control_plane_js_1.controlPlane.reset();
    (0, webhook_store_js_1.resetWebhookStore)();
    const created = (0, webhook_store_js_1.createWebhookSubscription)({
        name: 'Ops',
        endpointUrl: 'http://127.0.0.1:9/hooks',
        events: ['count.reviewed'],
        allowPrivate: true,
    });
    strict_1.default.equal('signingSecret' in created.subscription, false);
    strict_1.default.match(created.signingSecret, /^[a-f0-9]{64}$/);
    strict_1.default.equal((0, webhook_store_js_1.listWebhookSubscriptions)()[0].name, 'Ops');
    (0, webhook_store_js_1.setWebhookSubscriptionStatus)(created.subscription.id, 'PAUSED');
    const paused = await (0, webhook_dispatcher_js_1.dispatchWebhookEvent)({
        type: 'count.reviewed',
        entityId: 'count-1',
        data: { countId: 'count-1', status: 'APPROVED' },
    });
    strict_1.default.deepEqual(paused, []);
});
(0, node_test_1.default)('dispatcher signs the body and records delivered and failed attempts', async () => {
    control_plane_js_1.controlPlane.reset();
    (0, webhook_store_js_1.resetWebhookStore)();
    const calls = [];
    (0, webhook_dispatcher_js_1.setWebhookTransport)(async (url, init) => {
        calls.push({ url, body: init.body, headers: init.headers });
        if (url.includes('fail'))
            return { status: 500 };
        return { status: 204 };
    });
    const ok = (0, webhook_store_js_1.createWebhookSubscription)({
        name: 'OK',
        endpointUrl: 'https://hooks.example.com/ok',
        events: ['transfer.updated'],
    });
    (0, webhook_store_js_1.createWebhookSubscription)({
        name: 'Fail',
        endpointUrl: 'https://hooks.example.com/fail',
        events: ['transfer.updated'],
    });
    const deliveries = await (0, webhook_dispatcher_js_1.dispatchWebhookEvent)({
        type: 'transfer.updated',
        entityId: 'transfer-1',
        data: { transferId: 'transfer-1', status: 'DISPATCHED' },
    });
    (0, webhook_dispatcher_js_1.resetWebhookTransport)();
    strict_1.default.equal(deliveries.length, 2);
    strict_1.default.equal(deliveries.filter((row) => row.status === 'DELIVERED').length, 1);
    strict_1.default.equal(deliveries.filter((row) => row.status === 'FAILED').length, 1);
    const okCall = calls.find((call) => call.url === 'https://hooks.example.com/ok');
    strict_1.default.ok(okCall);
    strict_1.default.equal(okCall.headers['X-Invexa-Event'], 'transfer.updated');
    strict_1.default.equal((0, webhook_events_js_1.verifyWebhookSignature)(ok.signingSecret, okCall.body, okCall.headers['X-Invexa-Signature']), true);
    strict_1.default.equal(JSON.parse(okCall.body).data.transferId, 'transfer-1');
    strict_1.default.equal((0, webhook_store_js_1.listWebhookDeliveries)()[0].subscriptionId.length > 0, true);
});
(0, node_test_1.default)('a failed delivery is dead-lettered with a next-retry time, and replay resends the exact stored payload', async () => {
    control_plane_js_1.controlPlane.reset();
    (0, webhook_store_js_1.resetWebhookStore)();
    let calls = 0;
    const sentBodies = [];
    (0, webhook_dispatcher_js_1.setWebhookTransport)(async (url, init) => {
        calls += 1;
        sentBodies.push(init.body);
        return { status: calls === 1 ? 500 : 204 };
    });
    (0, webhook_store_js_1.createWebhookSubscription)({
        name: 'Flaky',
        endpointUrl: 'https://hooks.example.com/flaky',
        events: ['transfer.updated'],
    });
    const [first] = await (0, webhook_dispatcher_js_1.dispatchWebhookEvent)({
        type: 'transfer.updated',
        entityId: 'transfer-2',
        data: { transferId: 'transfer-2', status: 'DISPATCHED' },
    });
    strict_1.default.equal(first.status, 'FAILED');
    strict_1.default.equal(first.attemptCount, 1);
    strict_1.default.ok(first.nextRetryAt, 'a failed delivery must record when it can next be retried');
    strict_1.default.ok(first.payloadHash, 'a sync journal entry must record the payload hash');
    const replayed = await (0, webhook_dispatcher_js_1.replayDelivery)(first.id);
    strict_1.default.equal(replayed.status, 'DELIVERED');
    strict_1.default.equal(replayed.attemptCount, 2);
    strict_1.default.equal(replayed.nextRetryAt, null);
    strict_1.default.equal(sentBodies[0], sentBodies[1], 'replay must resend byte-identical payload for idempotent dedupe');
    (0, webhook_dispatcher_js_1.resetWebhookTransport)();
    await strict_1.default.rejects(() => (0, webhook_dispatcher_js_1.replayDelivery)(first.id), webhook_dispatcher_js_1.WebhookReplayError);
    await strict_1.default.rejects(() => (0, webhook_dispatcher_js_1.replayDelivery)('whdel-does-not-exist'), webhook_dispatcher_js_1.WebhookReplayError);
});
(0, node_test_1.default)('retryDueDeliveries only replays deliveries whose next-retry time has passed', async () => {
    control_plane_js_1.controlPlane.reset();
    (0, webhook_store_js_1.resetWebhookStore)();
    (0, webhook_dispatcher_js_1.setWebhookTransport)(async () => ({ status: 500 }));
    (0, webhook_store_js_1.createWebhookSubscription)({
        name: 'AlwaysDown',
        endpointUrl: 'https://hooks.example.com/down',
        events: ['transfer.updated'],
    });
    await (0, webhook_dispatcher_js_1.dispatchWebhookEvent)({
        type: 'transfer.updated',
        entityId: 'transfer-3',
        data: { transferId: 'transfer-3', status: 'DISPATCHED' },
    });
    const tooSoon = await (0, webhook_dispatcher_js_1.retryDueDeliveries)();
    strict_1.default.equal(tooSoon.retried, 0, 'the backoff has not elapsed yet, so nothing should be retried');
    (0, webhook_dispatcher_js_1.setWebhookTransport)(async () => ({ status: 204 }));
    const before = (0, webhook_store_js_1.listWebhookDeliveries)()[0];
    (0, webhook_store_js_1.updateWebhookDelivery)(before.id, { nextRetryAt: new Date(Date.now() - 1000).toISOString() });
    const due = await (0, webhook_dispatcher_js_1.retryDueDeliveries)();
    strict_1.default.equal(due.retried, 1);
    strict_1.default.equal(due.delivered, 1);
    (0, webhook_dispatcher_js_1.resetWebhookTransport)();
});
(0, node_test_1.default)('stock.low fires only when on-hand crosses the reorder minimum', async () => {
    control_plane_js_1.controlPlane.reset();
    (0, webhook_store_js_1.resetWebhookStore)();
    (0, reorder_store_js_1.resetReorderStore)();
    const received = [];
    (0, webhook_dispatcher_js_1.setWebhookTransport)(async (_url, init) => {
        received.push(JSON.parse(init.body).event);
        return { status: 200 };
    });
    (0, webhook_store_js_1.createWebhookSubscription)({
        name: 'Low',
        endpointUrl: 'https://hooks.example.com/low',
        events: ['stock.low'],
    });
    (0, reorder_store_js_1.upsertReorderRule)({ itemId: 'item-1003', locationId: 'wh-1', minQty: 79, targetQty: 90 });
    const before = (0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'wh-1')?.onHand ?? 0;
    strict_1.default.ok(before > 79);
    (0, webhook_dispatcher_js_1.maybeEmitStockLow)('item-1003', 'wh-1', before);
    await (0, webhook_dispatcher_js_1.waitForWebhooks)();
    strict_1.default.deepEqual(received, []);
    (0, repository_js_1.adjustStockLedger)('item-1003', 'lot-1003', 'wh-1', -2);
    (0, webhook_dispatcher_js_1.maybeEmitStockLow)('item-1003', 'wh-1', before);
    await (0, webhook_dispatcher_js_1.waitForWebhooks)();
    (0, repository_js_1.adjustStockLedger)('item-1003', 'lot-1003', 'wh-1', 2);
    (0, reorder_store_js_1.resetReorderStore)();
    (0, webhook_dispatcher_js_1.resetWebhookTransport)();
    strict_1.default.deepEqual(received, ['stock.low']);
});
(0, node_test_1.default)('emitWebhookEvent swallows transport crashes', async () => {
    control_plane_js_1.controlPlane.reset();
    (0, webhook_store_js_1.resetWebhookStore)();
    (0, webhook_dispatcher_js_1.setWebhookTransport)(async () => {
        throw new Error('boom');
    });
    (0, webhook_store_js_1.createWebhookSubscription)({
        name: 'Crash',
        endpointUrl: 'https://hooks.example.com/crash',
        events: ['purchase-order.received'],
    });
    const rows = await (0, webhook_dispatcher_js_1.emitWebhookEvent)({
        type: 'purchase-order.received',
        entityId: 'po-1',
        data: { purchaseOrderId: 'po-1', status: 'RECEIVED' },
    });
    (0, webhook_dispatcher_js_1.resetWebhookTransport)();
    strict_1.default.equal(rows[0]?.status, 'FAILED');
});
