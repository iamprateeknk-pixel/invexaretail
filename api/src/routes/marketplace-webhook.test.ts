import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import marketplaceWebhookRouter from './marketplace-webhook.js';
import { createConnector, resetConnectors } from '../lib/connectors.js';
import { JAIPUR_COMPANY_ID, DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { listAuditEvents } from '../lib/audit.js';

// Week 15: the signed marketplace webhook (memory mode). The regression that
// matters most is tenancy: a connector must resolve only ITS OWN company's
// SKUs and locations.

async function withServer(run: (post: (connectorId: string, body: unknown, secret: string, badSignature?: boolean) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', marketplaceWebhookRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  const post = async (connectorId: string, body: unknown, secret: string, badSignature = false) => {
    const raw = JSON.stringify(body);
    const signature = badSignature ? 'sha256=deadbeef' : `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/webhooks/marketplaces/${connectorId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Invexa-Signature': signature },
      body: raw,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  try {
    await run(post);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetConnectors();
  }
}

const orderFor = (ref: string, sku: string) => ({ orderId: ref, items: [{ sku, quantity: 1 }] });

test('an invalid signature is rejected and audited without touching the catalog', async () => {
  await withServer(async (post) => {
    const connector = createConnector({ name: 'FK', platform: 'FLIPKART', webhookSecret: 's3cret', tenantId: DEFAULT_COMPANY_ID });
    const res = await post(connector.id, orderFor('FK-1', 'SKU-1001'), 's3cret', true);
    assert.equal(res.status, 401);
    const audited = listAuditEvents().find((e) => e.action === 'CHANNEL_EVENT_REJECTED_SIGNATURE' && e.entityId === connector.id);
    assert.ok(audited);
    assert.match(String(audited.metadata?.payloadChecksum), /^[0-9a-f]{64}$/);
  });
});

test('a connector cannot resolve another company\'s SKU (cross-tenant ingest is a 409, not an order)', async () => {
  await withServer(async (post) => {
    // Jaipur's connector sends the DEFAULT company's SKU (SKU-1001).
    const jaipur = createConnector({ name: 'Jaipur FK', platform: 'FLIPKART', webhookSecret: 'j-secret', tenantId: JAIPUR_COMPANY_ID });
    const res = await post(jaipur.id, orderFor('FK-X-1', 'SKU-1001'), 'j-secret');
    assert.equal(res.status, 409);
    assert.match(res.body.message, /No matching SKUs/);
    assert.ok(listAuditEvents().some((e) => e.action === 'CHANNEL_EVENT_REJECTED_NO_SKU_MATCH' && e.entityId === jaipur.id));
  });
});

test('the same connector still resolves its own SKU, and a replay is one logical order', async () => {
  await withServer(async (post) => {
    const own = createConnector({ name: 'Own FK', platform: 'FLIPKART', webhookSecret: 'o-secret', tenantId: DEFAULT_COMPANY_ID });
    const first = await post(own.id, orderFor('FK-OWN-1', 'SKU-1001'), 'o-secret');
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const replay = await post(own.id, orderFor('FK-OWN-1', 'SKU-1001'), 'o-secret');
    assert.equal(replay.status, 200, 'replaying the same marketplace order is a duplicate, not a second order');
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.order.id, first.body.order.id);
  });
});
