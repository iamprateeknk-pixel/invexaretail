import test from 'node:test';
import assert from 'node:assert/strict';

import { resetReorderStore, upsertReorderRule } from './reorder-store.js';
import { adjustStockLedger, findStockLedgerEntry } from './repository.js';
import {
  dispatchWebhookEvent,
  emitWebhookEvent,
  maybeEmitStockLow,
  replayDelivery,
  retryDueDeliveries,
  resetWebhookTransport,
  setWebhookTransport,
  waitForWebhooks,
  WebhookReplayError,
} from './webhook-dispatcher.js';
import { verifyWebhookSignature } from './webhook-events.js';
import {
  createWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  resetWebhookStore,
  setWebhookSubscriptionStatus,
  updateWebhookDelivery,
} from './webhook-store.js';
import { controlPlane } from './saas/control-plane.js';

test('subscriptions hide signing secrets and pause skips delivery', async () => {
  controlPlane.reset();
  resetWebhookStore();
  const created = createWebhookSubscription({
    companyId: 'default-company',
    name: 'Ops',
    endpointUrl: 'http://127.0.0.1:9/hooks',
    events: ['count.reviewed'],
    allowPrivate: true,
  });
  assert.equal('signingSecret' in created.subscription, false);
  assert.match(created.signingSecret, /^[a-f0-9]{64}$/);
  assert.equal(listWebhookSubscriptions('default-company')[0].name, 'Ops');

  setWebhookSubscriptionStatus(created.subscription.id, 'PAUSED', 'default-company');
  const paused = await dispatchWebhookEvent({
    type: 'count.reviewed',
    entityId: 'count-1',
    data: { companyId: 'default-company', countId: 'count-1', status: 'APPROVED' },
  });
  assert.deepEqual(paused, []);
});

test('dispatcher signs the body and records delivered and failed attempts', async () => {
  controlPlane.reset();
  resetWebhookStore();
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  setWebhookTransport(async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    if (url.includes('fail')) return { status: 500 };
    return { status: 204 };
  });
  const ok = createWebhookSubscription({
    companyId: 'default-company',
    name: 'OK',
    endpointUrl: 'https://hooks.example.com/ok',
    events: ['transfer.updated'],
  });
  createWebhookSubscription({
    companyId: 'default-company',
    name: 'Fail',
    endpointUrl: 'https://hooks.example.com/fail',
    events: ['transfer.updated'],
  });

  const deliveries = await dispatchWebhookEvent({
    type: 'transfer.updated',
    entityId: 'transfer-1',
    data: { companyId: 'default-company', transferId: 'transfer-1', status: 'DISPATCHED' },
  });
  resetWebhookTransport();

  assert.equal(deliveries.length, 2);
  assert.equal(deliveries.filter((row) => row.status === 'DELIVERED').length, 1);
  assert.equal(deliveries.filter((row) => row.status === 'FAILED').length, 1);
  const okCall = calls.find((call) => call.url === 'https://hooks.example.com/ok');
  assert.ok(okCall);
  assert.equal(okCall.headers['X-Invexa-Event'], 'transfer.updated');
  assert.equal(verifyWebhookSignature(ok.signingSecret, okCall.body, okCall.headers['X-Invexa-Signature']), true);
  assert.equal(JSON.parse(okCall.body).data.transferId, 'transfer-1');
  assert.equal(listWebhookDeliveries()[0].subscriptionId.length > 0, true);
});

test('a failed delivery is dead-lettered with a next-retry time, and replay resends the exact stored payload', async () => {
  controlPlane.reset();
  resetWebhookStore();
  let calls = 0;
  const sentBodies: string[] = [];
  setWebhookTransport(async (url, init) => {
    calls += 1;
    sentBodies.push(init.body);
    return { status: calls === 1 ? 500 : 204 };
  });
  createWebhookSubscription({
    companyId: 'default-company',
    name: 'Flaky',
    endpointUrl: 'https://hooks.example.com/flaky',
    events: ['transfer.updated'],
  });

  const [first] = await dispatchWebhookEvent({
    type: 'transfer.updated',
    entityId: 'transfer-2',
    data: { companyId: 'default-company', transferId: 'transfer-2', status: 'DISPATCHED' },
  });
  assert.equal(first.status, 'FAILED');
  assert.equal(first.attemptCount, 1);
  assert.ok(first.nextRetryAt, 'a failed delivery must record when it can next be retried');
  assert.ok(first.payloadHash, 'a sync journal entry must record the payload hash');

  const replayed = await replayDelivery(first.id);
  assert.equal(replayed.status, 'DELIVERED');
  assert.equal(replayed.attemptCount, 2);
  assert.equal(replayed.nextRetryAt, null);
  assert.equal(sentBodies[0], sentBodies[1], 'replay must resend byte-identical payload for idempotent dedupe');
  resetWebhookTransport();

  await assert.rejects(() => replayDelivery(first.id), WebhookReplayError);
  await assert.rejects(() => replayDelivery('whdel-does-not-exist'), WebhookReplayError);
});

test('retryDueDeliveries only replays deliveries whose next-retry time has passed', async () => {
  controlPlane.reset();
  resetWebhookStore();
  setWebhookTransport(async () => ({ status: 500 }));
  createWebhookSubscription({
    companyId: 'default-company',
    name: 'AlwaysDown',
    endpointUrl: 'https://hooks.example.com/down',
    events: ['transfer.updated'],
  });
  await dispatchWebhookEvent({
    type: 'transfer.updated',
    entityId: 'transfer-3',
    data: { companyId: 'default-company', transferId: 'transfer-3', status: 'DISPATCHED' },
  });

  const tooSoon = await retryDueDeliveries();
  assert.equal(tooSoon.retried, 0, 'the backoff has not elapsed yet, so nothing should be retried');

  setWebhookTransport(async () => ({ status: 204 }));
  const before = listWebhookDeliveries()[0];
  updateWebhookDelivery(before.id, { nextRetryAt: new Date(Date.now() - 1000).toISOString() });
  const due = await retryDueDeliveries();
  assert.equal(due.retried, 1);
  assert.equal(due.delivered, 1);
  resetWebhookTransport();
});

test('stock.low fires only when on-hand crosses the reorder minimum', async () => {
  controlPlane.reset();
  resetWebhookStore();
  resetReorderStore();
  const received: string[] = [];
  setWebhookTransport(async (_url, init) => {
    received.push(JSON.parse(init.body).event);
    return { status: 200 };
  });
  createWebhookSubscription({
    companyId: 'default-company',
    name: 'Low',
    endpointUrl: 'https://hooks.example.com/low',
    events: ['stock.low'],
  });
  upsertReorderRule({ itemId: 'item-1003', locationId: 'wh-1', minQty: 79, targetQty: 90 });
  const before = findStockLedgerEntry('item-1003', 'lot-1003', 'wh-1')?.onHand ?? 0;
  assert.ok(before > 79);
  maybeEmitStockLow('item-1003', 'wh-1', before);
  await waitForWebhooks();
  assert.deepEqual(received, []);

  adjustStockLedger('item-1003', 'lot-1003', 'wh-1', -2);
  maybeEmitStockLow('item-1003', 'wh-1', before);
  await waitForWebhooks();
  adjustStockLedger('item-1003', 'lot-1003', 'wh-1', 2);
  resetReorderStore();
  resetWebhookTransport();
  assert.deepEqual(received, ['stock.low']);
});

test('emitWebhookEvent swallows transport crashes', async () => {
  controlPlane.reset();
  resetWebhookStore();
  setWebhookTransport(async () => {
    throw new Error('boom');
  });
  createWebhookSubscription({
    companyId: 'default-company',
    name: 'Crash',
    endpointUrl: 'https://hooks.example.com/crash',
    events: ['purchase-order.received'],
  });
  const rows = await emitWebhookEvent({
    type: 'purchase-order.received',
    entityId: 'po-1',
    data: { companyId: 'default-company', purchaseOrderId: 'po-1', status: 'RECEIVED' },
  });
  resetWebhookTransport();
  assert.equal(rows[0]?.status, 'FAILED');
});

test('events are delivered only to the subscriptions of the company that produced them', async () => {
  controlPlane.reset();
  resetWebhookStore();
  const urls: string[] = [];
  setWebhookTransport(async (url) => { urls.push(url); return { status: 204 }; });
  try {
    createWebhookSubscription({ companyId: 'company-a', name: 'A hook', endpointUrl: 'http://127.0.0.1:9/a', events: ['count.reviewed'], allowPrivate: true });
    createWebhookSubscription({ companyId: 'company-b', name: 'B hook', endpointUrl: 'http://127.0.0.1:9/b', events: ['count.reviewed'], allowPrivate: true });

    const forA = await dispatchWebhookEvent({ type: 'count.reviewed', data: { companyId: 'company-a', countId: 'c1' } });
    assert.equal(forA.length, 1);
    assert.deepEqual(urls, ['http://127.0.0.1:9/a'], 'company B must never receive company A\'s event');
    assert.equal(forA[0].companyId, 'company-a');

    urls.length = 0;
    const unattributable = await dispatchWebhookEvent({ type: 'count.reviewed', data: { countId: 'c2' } });
    assert.deepEqual(unattributable, [], 'an event whose company cannot be determined is dropped, not broadcast');
    assert.deepEqual(urls, []);
  } finally {
    resetWebhookTransport();
  }
});

test('subscription lists, status changes, delivery logs and replay are company scoped (foreign id looks missing)', async () => {
  controlPlane.reset();
  resetWebhookStore();
  let status = 500;
  setWebhookTransport(async () => ({ status }));
  try {
    const a = createWebhookSubscription({ companyId: 'company-a', name: 'A hook', endpointUrl: 'http://127.0.0.1:9/a', events: ['count.reviewed'], allowPrivate: true });
    createWebhookSubscription({ companyId: 'company-b', name: 'B hook', endpointUrl: 'http://127.0.0.1:9/b', events: ['count.reviewed'], allowPrivate: true });

    assert.deepEqual(listWebhookSubscriptions('company-a').map((row) => row.name), ['A hook']);
    assert.deepEqual(listWebhookSubscriptions('company-b').map((row) => row.name), ['B hook']);
    assert.throws(() => setWebhookSubscriptionStatus(a.subscription.id, 'PAUSED', 'company-b'), /not found/);
    assert.equal(setWebhookSubscriptionStatus(a.subscription.id, 'ACTIVE', 'company-a').status, 'ACTIVE', 'the identical call works for the owner');

    const [failed] = await dispatchWebhookEvent({ type: 'count.reviewed', data: { companyId: 'company-a', countId: 'c1' } });
    assert.equal(failed.status, 'FAILED');
    assert.equal(listWebhookDeliveries(100, 'company-b').length, 0, 'company B sees none of company A\'s delivery payloads');
    assert.equal(listWebhookDeliveries(100, 'company-a').length, 1);
    await assert.rejects(() => replayDelivery(failed.id, 'company-b'), WebhookReplayError);
    status = 204;
    assert.equal((await replayDelivery(failed.id, 'company-a')).status, 'DELIVERED');
  } finally {
    resetWebhookTransport();
  }
});
