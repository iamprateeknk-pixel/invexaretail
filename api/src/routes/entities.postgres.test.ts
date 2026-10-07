// Entity 360 on real Postgres: each view tells the story of one thing (summary, what it is connected to,
// what happened to it) and is strictly company scoped - a foreign id is 404, never 403, and the identical
// call succeeds for the owner. User 360 is limited to management roles. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import entitiesRouter from './entities.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

type Api = (path: string, token: string) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', entitiesRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('failed to bind test server'); }
  const call: Api = async (path, token) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const companyIds: string[] = [];
async function makeUser(label: string, role: string, companyId?: string) {
  const company = companyId ?? `e360-co-${label}-${randomUUID()}`;
  if (!companyId) { await prisma.companyProfile.create({ data: { id: company, name: company } }); companyIds.push(company); }
  const userId = `e360-${label}-${randomUUID()}`;
  const email = `${userId}@test.invexa.local`;
  await prisma.user.create({ data: { id: userId, name: label, email, passwordHash: 'x', role: role as never, assignedLocations: '[]', companyId: company } });
  createEnhancedUser({ id: userId, companyId: company, email, name: label, role: role as never, branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  return { companyId: company, userId, token: generateJWT(userId, company) };
}

test.after(async () => {
  if (!companyIds.length) return;
  await prisma.exceptionCase.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.stockCount.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.transferLine.deleteMany({ where: { transfer: { companyId: { in: companyIds } } } });
  await prisma.transfer.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.stockMovement.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.stockLedger.deleteMany({ where: { companyId: { in: companyIds } } });
});

const field = (view: { summary: Array<{ label: string; value: string }> }, label: string) => view.summary.find((row) => row.label === label)?.value;

integration('Entity 360: lot, location, transfer, count and user views are complete, company scoped, and 404 for foreign ids', async () => {
  const a = await makeUser('a', 'ADMIN');
  const b = await makeUser('b', 'ADMIN');
  const clerk = await makeUser('clerk', 'STORE_USER', a.companyId);
  const locationId = `e360-loc-${randomUUID()}`;
  const otherLocationId = `e360-loc2-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Main Store', type: 'store', companyId: a.companyId } });
  await prisma.location.create({ data: { id: otherLocationId, code: otherLocationId, name: 'Warehouse', type: 'warehouse', companyId: a.companyId } });
  const itemId = `e360-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: 'RICE-360', name: 'Rice', unit: 'ea', companyId: a.companyId } });
  const lot = await prisma.lot.create({ data: { lotNo: 'L-360', itemId, expiryDate: new Date('2027-01-01') } });
  await prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand: 12, reserved: 2, companyId: a.companyId } });
  await prisma.stockMovement.create({ data: { itemId, lotId: lot.id, locationId, movementType: 'PURCHASE_RECEIPT', qtyDelta: 12, beforeBalance: 0, afterBalance: 12, timestamp: new Date(), companyId: a.companyId } });
  const transfer = await prisma.transfer.create({
    data: { sourceLocationId: otherLocationId, destinationLocationId: locationId, requestedById: a.userId, status: 'IN_TRANSIT', companyId: a.companyId, lines: { create: [{ itemId, lotId: lot.id, requestedQty: 5, pickedQty: 5 }] } },
  });
  const count = await prisma.stockCount.create({ data: { itemId, lotId: lot.id, locationId, physicalQty: 10, bookQty: 12, submittedById: clerk.userId, companyId: a.companyId } });
  await prisma.exceptionCase.create({ data: { type: 'DAMAGE', title: 'Torn bag', itemId, lotId: lot.id, locationId, reportedById: a.userId, ownerId: clerk.userId, companyId: a.companyId } });

  await withServer(async (call) => {
    const lotView = (await call(`/entities/lot/${lot.id}/360`, a.token)).body.entity;
    assert.equal(lotView.title, 'Lot L-360');
    assert.equal(field(lotView, 'On hand'), '12');
    assert.ok(lotView.related.some((row: { kind: string }) => row.kind === 'exception'), 'the lot shows its exception');
    assert.ok(lotView.related.some((row: { kind: string; id: string }) => row.kind === 'transfer' && row.id === transfer.id), 'and the transfer that moves it');
    assert.ok(lotView.timeline.some((row: { kind: string; title: string }) => row.kind === 'movement' && row.title.startsWith('PURCHASE_RECEIPT')), 'and its movement history');

    const locationView = (await call(`/entities/location/${locationId}/360`, a.token)).body.entity;
    assert.equal(field(locationView, 'Open transfers'), '1');
    assert.equal(field(locationView, 'Open exceptions'), '1');

    const transferView = (await call(`/entities/transfer/${transfer.id}/360`, a.token)).body.entity;
    assert.equal(field(transferView, 'Requested'), '5');
    assert.ok(transferView.related.some((row: { kind: string; id: string }) => row.kind === 'lot' && row.id === lot.id));

    const countView = (await call(`/entities/count/${count.id}/360`, a.token)).body.entity;
    assert.equal(field(countView, 'Variance'), '-2');

    const userView = (await call(`/entities/user/${clerk.userId}/360`, a.token)).body.entity;
    assert.equal(field(userView, 'Open exceptions owned'), '1');

    // Company B sees none of it - 404 for every type, never 403.
    for (const path of [`/entities/lot/${lot.id}/360`, `/entities/location/${locationId}/360`, `/entities/transfer/${transfer.id}/360`, `/entities/count/${count.id}/360`, `/entities/user/${clerk.userId}/360`]) {
      assert.equal((await call(path, b.token)).status, 404, `${path} must be 404 for another company`);
    }
    // A store user may open operational views but not another person profile.
    assert.equal((await call(`/entities/lot/${lot.id}/360`, clerk.token)).status, 200);
    assert.equal((await call(`/entities/user/${a.userId}/360`, clerk.token)).status, 404, 'user 360 is for management roles');
    assert.equal((await call('/entities/spaceship/x/360', a.token)).status, 404, 'unknown type');
  });
});
