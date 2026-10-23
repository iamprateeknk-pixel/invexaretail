// Wave 3 (P1-10): GET /expiry-alerts and GET /expiry-board read the stock
// ledger in DB mode filtered by locationId only - the sibling of the
// Phase 5 GET /stock leak. Any user who could name a locationId read the
// item names, lot numbers, expiry dates and exact on-hand of whichever
// company held stock there. Both queries are now company-scoped; this
// test seeds two companies' ledger rows at the SAME locationId and
// asserts only the caller's own rows come back. DB-only - skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { enforceOperationalCompanyScope, registerLocationCompany } from '../lib/saas/tenant-scope.js';
import { extractToken } from './enterprise-auth.js';
import opextRouter from './operations-extension.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function withServer(run: (get: (path: string, token: string) => Promise<{ status: number; body: any }>) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', opextRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const get = async (path: string, token: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try {
    await run(get);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function seedCompanyStock(companyId: string, locationId: string, expiryDate: Date) {
  const item = await prisma.item.create({ data: { code: `EXP-${randomUUID().slice(0, 8)}`, name: 'I', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}`, expiryDate } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId, onHand: 5, companyId } });
  return { itemId: item.id, lotId: lot.id };
}

integration('expiry alerts and board return only the caller\u2019s company rows at a shared locationId', async () => {
  const companyA = `exp-co-${randomUUID()}`;
  const companyB = `exp-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyA, name: companyA } });
  await prisma.companyProfile.create({ data: { id: companyB, name: companyB } });
  const userId = `exp-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Expiry Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId: companyA } });
  createEnhancedUser({ id: userId, companyId: companyA, email: `${userId}@test.invexa.local`, name: 'Expiry Admin', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const locationId = `exp-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Expiry Loc', type: 'warehouse', companyId: companyA } });
  registerLocationCompany(locationId, companyA);
  const expiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const a = await seedCompanyStock(companyA, locationId, expiry);
  const b = await seedCompanyStock(companyB, locationId, expiry);
  const token = generateJWT(userId, companyA);

  await withServer(async (get) => {
    const alerts = await get(`/expiry-alerts?locationId=${locationId}`, token);
    assert.equal(alerts.status, 200, JSON.stringify(alerts.body));
    assert.equal(alerts.body.alerts.length, 1, 'exactly one alert: the caller\u2019s own expiring row');
    assert.equal(alerts.body.alerts[0].itemId, a.itemId);
    assert.ok(!JSON.stringify(alerts.body).includes(b.itemId), 'the other company\u2019s item must not appear in alerts');

    const board = await get(`/expiry-board?locationId=${locationId}`, token);
    assert.equal(board.status, 200, JSON.stringify(board.body));
    assert.ok(JSON.stringify(board.body).includes(a.itemId), 'the caller\u2019s stock is on the board');
    assert.ok(!JSON.stringify(board.body).includes(b.itemId), 'the other company\u2019s stock must not appear on the board');
  });
});
