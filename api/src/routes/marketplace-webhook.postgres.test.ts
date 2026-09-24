// Guide Week 15 against real Postgres: the durable webhook event log makes a
// replay one logical order, records provider event -> order, and a delivery
// from one company's connector cannot resolve another company's SKUs.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../lib/db.js';
import marketplaceWebhookRouter from './marketplace-webhook.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function withServer(run: (post: (connectorId: string, body: unknown, secret: string, headers?: Record<string, string>) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', marketplaceWebhookRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  const post = async (connectorId: string, body: unknown, secret: string, headers: Record<string, string> = {}) => {
    const raw = JSON.stringify(body);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/webhooks/marketplaces/${connectorId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Invexa-Signature': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`, ...headers },
      body: raw,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  try { await run(post); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function makeCompany(stock = 10) {
  const companyId = `mkt-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const loc = await prisma.location.create({ data: { id: `mkt-loc-${randomUUID()}`, code: `mkt-${randomUUID()}`, name: 'Hub', type: 'warehouse', companyId } });
  const item = await prisma.item.create({ data: { code: `MKT-${randomUUID().slice(0, 8)}`, name: 'Mkt item', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: loc.id, onHand: stock, companyId } });
  const secret = `secret-${randomUUID()}`;
  const connector = await prisma.marketplaceConnector.create({ data: { name: 'FK', platform: 'FLIPKART', channel: 'FLIPKART', webhookSecret: secret, tenantId: companyId } });
  return { companyId, loc, item, lot, secret, connector };
}

const order = (ref: string, sku: string) => ({ orderId: ref, items: [{ sku, quantity: 2 }] });

integration('a replayed delivery is one order, one reservation, and the event log ties event to order', async () => {
  const a = await makeCompany(10);
  const ref = `FK-${randomUUID().slice(0, 8)}`;
  await withServer(async (post) => {
    const first = await post(a.connector.id, order(ref, a.item.code), a.secret);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const replay = await post(a.connector.id, order(ref, a.item.code), a.secret);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.order.id, first.body.order.id);
  });
  assert.equal(await prisma.order.count({ where: { externalReference: ref, companyId: a.companyId } }), 1);
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: a.item.id } });
  assert.equal(ledger.reserved, 2, 'reserved exactly once');
  const events = await prisma.channelWebhookEvent.findMany({ where: { connectorId: a.connector.id } });
  assert.equal(events.length, 1);
  assert.equal(events[0].state, 'PROCESSED');
  assert.equal(events[0].eventId, ref);
  assert.equal(events[0].companyId, a.companyId);
  assert.match(events[0].payloadChecksum, /^[0-9a-f]{64}$/);
  assert.ok(events[0].orderId);
});

integration('an explicit X-Invexa-Event-Id is the dedupe key', async () => {
  const a = await makeCompany(10);
  await withServer(async (post) => {
    const eventId = `evt-${randomUUID()}`;
    const first = await post(a.connector.id, order(`FK-${randomUUID().slice(0, 8)}`, a.item.code), a.secret, { 'X-Invexa-Event-Id': eventId });
    assert.equal(first.status, 201);
    // Same event id redelivered with a different order reference is still the same event.
    const again = await post(a.connector.id, order(`FK-${randomUUID().slice(0, 8)}`, a.item.code), a.secret, { 'X-Invexa-Event-Id': eventId });
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
  });
  assert.equal(await prisma.order.count({ where: { companyId: a.companyId } }), 1);
});

integration('a rejected delivery (unknown SKU) is logged REJECTED and can be retried once the SKU exists', async () => {
  const a = await makeCompany(10);
  const ref = `FK-${randomUUID().slice(0, 8)}`;
  await withServer(async (post) => {
    const bad = await post(a.connector.id, order(ref, 'NO-SUCH-SKU'), a.secret);
    assert.equal(bad.status, 409);
    assert.equal((await prisma.channelWebhookEvent.findFirstOrThrow({ where: { connectorId: a.connector.id } })).state, 'REJECTED');
    const ok = await post(a.connector.id, order(ref, a.item.code), a.secret);
    assert.equal(ok.status, 201);
  });
  assert.equal((await prisma.channelWebhookEvent.findFirstOrThrow({ where: { connectorId: a.connector.id } })).state, 'PROCESSED');
});

integration('company B\'s connector cannot resolve company A\'s SKU or reserve A\'s stock', async () => {
  const a = await makeCompany(10);
  const b = await makeCompany(10);
  await withServer(async (post) => {
    const res = await post(b.connector.id, order(`FK-${randomUUID().slice(0, 8)}`, a.item.code), b.secret);
    assert.equal(res.status, 409);
  });
  assert.equal((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: a.item.id } })).reserved, 0);
  assert.equal(await prisma.order.count({ where: { companyId: b.companyId } }), 0);
});
