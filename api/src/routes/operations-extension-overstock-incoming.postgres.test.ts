// Audit R-1: overstock/network-need recommendations used to compare each network location's
// on-hand against its minimum with no regard for stock already on its way there - so a needy
// store with a transfer already dispatched to it still got recommended a second one. Proves
// GET /intelligence/:locationId now reduces (and, when fully covered, drops) a needy location's
// recommended transfer by what is already DISPATCHED/IN_TRANSIT/PARTIAL_RECEIVED to it, company
// wide, not just what is inbound to the location being viewed. DB-only - skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import operationsExtensionRouter from './operations-extension.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', operationsExtensionRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('failed to bind test server'); }
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call: Api = async (method, path, token) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

integration("a needy store's overstock-transfer recommendation is reduced by stock already dispatched to it, and dropped once fully covered", async () => {
  const companyId = `ops-oi-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-oi-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'A', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'A', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const token = generateJWT(userId, companyId);

  const donor = await prisma.location.create({ data: { code: `oi-donor-${randomUUID()}`, name: 'Donor WH', type: 'warehouse', companyId } });
  const needy = await prisma.location.create({ data: { code: `oi-needy-${randomUUID()}`, name: 'Needy Store', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `OI-${randomUUID().slice(0, 8)}`, name: 'Overstocked item', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });

  // Donor's own reorder rule (minQty/targetQty here double as the network-wide threshold this
  // endpoint's overstock rows are built against - see the comment above buildOverstockRecommendations).
  await prisma.reorderRule.create({ data: { itemId: item.id, locationId: donor.id, minQty: 10, targetQty: 20, companyId } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: donor.id, onHand: 100, companyId } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: needy.id, onHand: 0, companyId } });

  const findRec = (body: any) => body.intelligence.overstock.find((row: { itemId: string; destinationLocationId: string }) => row.itemId === item.id && row.destinationLocationId === needy.id);

  await withServer(async (call) => {
    const before = await call('GET', `/intelligence/${donor.id}`, token);
    assert.equal(before.status, 200, JSON.stringify(before.body));
    const recBefore = findRec(before.body);
    assert.ok(recBefore, 'with nothing in transit, the needy store must be recommended a transfer');
    assert.equal(recBefore.suggestedTransferQty, 10, 'need = minQty(10) - onHand(0)');

    // A transfer for the full need is already on its way to the needy store.
    await prisma.transfer.create({
      data: {
        sourceLocationId: donor.id, destinationLocationId: needy.id, requestedById: userId,
        status: 'DISPATCHED', companyId,
        lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: 10, receivedQty: 0 }] },
      },
    });

    const after = await call('GET', `/intelligence/${donor.id}`, token);
    assert.equal(after.status, 200, JSON.stringify(after.body));
    assert.equal(findRec(after.body), undefined, 'need is already fully covered by the in-flight transfer: no duplicate recommendation');
  });
});

integration("an expiring lot is suggested as a TRANSFER to a genuinely faster-selling branch, not just MARKDOWN (audit R-1)", async () => {
  const companyId = `ops-xt-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-xt-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'A', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'A', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const token = generateJWT(userId, companyId);

  const slow = await prisma.location.create({ data: { code: `xt-slow-${randomUUID()}`, name: 'Slow Store', type: 'store', companyId } });
  const fast = await prisma.location.create({ data: { code: `xt-fast-${randomUUID()}`, name: 'Fast Store', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `XT-${randomUUID().slice(0, 8)}`, name: 'Expiring item', companyId } });
  const day = 86_400_000;
  const expiringLot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-EXP-${randomUUID().slice(0, 6)}`, expiryDate: new Date(Date.now() + 10 * day) } });
  const fastLot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-FAST-${randomUUID().slice(0, 6)}` } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: expiringLot.id, locationId: slow.id, onHand: 100, companyId } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: fastLot.id, locationId: fast.id, onHand: 20, companyId } });

  // Slow store: 1 unit/day. Fast store: 5 units/day - genuinely faster.
  const sale = (locationId: string, lotId: string, daysAgo: number, qty: number) => prisma.stockMovement.create({ data: { itemId: item.id, lotId, locationId, movementType: 'SALES_DEDUCTION', qtyDelta: -qty, beforeBalance: qty, afterBalance: 0, actor: userId, timestamp: new Date(Date.now() - daysAgo * day), companyId } });
  for (let d = 1; d <= 20; d += 1) await sale(slow.id, expiringLot.id, d, 1);
  for (let d = 1; d <= 20; d += 1) await sale(fast.id, fastLot.id, d, 5);

  await withServer(async (call) => {
    const res = await call('GET', `/intelligence/${slow.id}`, token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rec = res.body.intelligence.expiryActions.find((row: { itemId: string }) => row.itemId === item.id);
    assert.ok(rec, 'the expiring lot must produce a recommendation');
    assert.equal(rec.suggestedAction, 'TRANSFER', `expected TRANSFER to the faster branch, got ${JSON.stringify(rec)}`);
    assert.equal(rec.destinationLocationId, fast.id);
    assert.ok(rec.suggestedTransferQty > 0);
  });
});
