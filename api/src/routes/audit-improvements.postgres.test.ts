// Real-Postgres coverage for the inventory-audit improvements that touch routes:
//  - purchase plan ignores stock nobody can sell (expired / blocked lots) as cover   (O-6)
//  - reorder rules accept fractional quantities for KG items only                    (O-4)
//  - jobs are company scoped: list, lines, status, consume, create                    (T-1)
//  - PO/JOB numbers are unique per company                                            (T-1)
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import catalogProcurementRouter from './catalog-procurement.js';
import operationsExtensionRouter from './operations-extension.js';
import reportsRouter from './reports.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', catalogProcurementRouter);
  app.use('/api/v1', operationsExtensionRouter);
  app.use('/api/v1', reportsRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  const call: Api = async (method, path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function makeCompany() {
  const companyId = `aud-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `aud-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'A', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'A', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const loc = await prisma.location.create({ data: { id: `aud-loc-${randomUUID()}`, code: `aud-${randomUUID()}`, name: 'Store', type: 'store', companyId } });
  return { companyId, userId, loc, token: generateJWT(userId, companyId) };
}

integration('the purchase plan does not count expired or blocked lots as cover', async () => {
  const a = await makeCompany();
  const item = await prisma.item.create({ data: { code: `PLN-${randomUUID().slice(0, 8)}`, name: 'Plan item', companyId: a.companyId } });
  const expired = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'OLD', expiryDate: new Date('2020-01-01T00:00:00Z') } });
  const blocked = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'BLK', status: 'BLOCKED' } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: expired.id, locationId: a.loc.id, onHand: 50, companyId: a.companyId } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: blocked.id, locationId: a.loc.id, onHand: 50, companyId: a.companyId } });
  await prisma.reorderRule.create({ data: { itemId: item.id, locationId: a.loc.id, minQty: 10, targetQty: 40, companyId: a.companyId } });
  await withServer(async (call) => {
    const res = await call('GET', `/purchase-orders/plan?locationId=${a.loc.id}`, a.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const suggestion = res.body.suggestions.find((s: { itemId: string }) => s.itemId === item.id);
    assert.ok(suggestion, '100 units on hand but none sellable: the item must be flagged, not "covered"');
    assert.equal(suggestion.position, 0);
    assert.equal(suggestion.urgency, 'CRITICAL');
  });
});

integration('reorder rules: fractional quantities are accepted for KG items and rejected for counted items', async () => {
  const a = await makeCompany();
  const kg = await prisma.item.create({ data: { code: `KG-${randomUUID().slice(0, 8)}`, name: 'Loose rice', decimalQuantity: true, companyId: a.companyId } });
  const pcs = await prisma.item.create({ data: { code: `PC-${randomUUID().slice(0, 8)}`, name: 'Soap', companyId: a.companyId } });
  await withServer(async (call) => {
    const ok = await call('PUT', `/reorder-rules/${kg.id}`, a.token, { locationId: a.loc.id, minQty: 2.5, targetQty: 10.25 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.rule.minQty, 2.5);
    const rejected = await call('PUT', `/reorder-rules/${pcs.id}`, a.token, { locationId: a.loc.id, minQty: 2.5, targetQty: 10 });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.message, /whole numbers/);
  });
});

integration('jobs are company scoped: another company cannot list, extend, change or consume them, or create one at your location', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const item = await prisma.item.create({ data: { code: `JOB-${randomUUID().slice(0, 8)}`, name: 'Job item', companyId: a.companyId } });
  await withServer(async (call) => {
    const created = await call('POST', '/jobs', a.token, { name: 'A job', locationId: a.loc.id });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const jobId = created.body.job.id;
    assert.equal(created.body.job.companyId, a.companyId);
    assert.match(created.body.job.number, /^JOB-\d{6}-[0-9A-Z]{8}$/);
    const line = await call('POST', `/jobs/${jobId}/lines`, a.token, { itemId: item.id, plannedQty: 3 });
    assert.equal(line.status, 201);

    assert.equal((await call('GET', '/jobs', b.token)).body.jobs.some((j: { id: string }) => j.id === jobId), false, 'B must not see A\'s job');
    assert.equal((await call('GET', '/jobs', a.token)).body.jobs.some((j: { id: string }) => j.id === jobId), true);
    assert.equal((await call('POST', `/jobs/${jobId}/lines`, b.token, { itemId: item.id, plannedQty: 1 })).status, 404);
    assert.equal((await call('PATCH', `/jobs/${jobId}/status`, b.token, { status: 'CANCELLED' })).status, 404);
    assert.equal((await call('PATCH', `/jobs/${jobId}/lines/${line.body.line.id}`, b.token, { issuedQty: 99 })).status, 404);
    assert.equal((await call('POST', `/jobs/${jobId}/consume`, b.token, { lineId: line.body.line.id, quantity: 1 })).status, 404);
    assert.equal((await call('POST', '/jobs', b.token, { name: 'Sneaky', locationId: a.loc.id })).status, 404, 'cannot create a job at another company\'s location');
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status, 'DRAFT');
    assert.equal((await prisma.jobLine.findUniqueOrThrow({ where: { id: line.body.line.id } })).issuedQty, 0);

    // A line id from ANOTHER job of the same company must not be editable through this job.
    const other = await call('POST', '/jobs', a.token, { name: 'A other job', locationId: a.loc.id });
    assert.equal((await call('PATCH', `/jobs/${other.body.job.id}/lines/${line.body.line.id}`, a.token, { issuedQty: 5 })).status, 404);
  });
});

integration('two companies can hold the same PO and job number; one company cannot', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const supplier = await prisma.supplier.create({ data: { name: `S-${randomUUID()}`, companyId: a.companyId } as never });
  const number = `PO-SHARED-${randomUUID().slice(0, 6)}`;
  const mk = (company: { companyId: string; userId: string; loc: { id: string } }) =>
    prisma.purchaseOrder.create({ data: { number, supplierId: supplier.id, locationId: company.loc.id, createdById: company.userId, companyId: company.companyId } });
  await mk(a);
  await mk(b);
  await assert.rejects(mk(a));
  await prisma.job.create({ data: { number: 'J-1', name: 'x', companyId: a.companyId, locationId: a.loc.id, createdById: a.userId } });
  await prisma.job.create({ data: { number: 'J-1', name: 'x', companyId: b.companyId, locationId: b.loc.id, createdById: b.userId } });
  await assert.rejects(prisma.job.create({ data: { number: 'J-1', name: 'x', companyId: a.companyId, locationId: a.loc.id, createdById: a.userId } }));
});

integration('GET /purchase-orders is bounded and pages with a cursor, returning every order exactly once, only this company\'s', async () => {
  const a = await makeCompany();
  const other = await makeCompany();
  const supplier = await prisma.supplier.create({ data: { name: `S-${randomUUID()}`, companyId: a.companyId } as never });
  for (let i = 0; i < 7; i += 1) {
    await prisma.purchaseOrder.create({ data: { number: `PG-${i}-${randomUUID().slice(0, 4)}`, supplierId: supplier.id, locationId: a.loc.id, createdById: a.userId, companyId: a.companyId } });
  }
  await prisma.purchaseOrder.create({ data: { number: `PG-X-${randomUUID().slice(0, 4)}`, supplierId: supplier.id, locationId: other.loc.id, createdById: other.userId, companyId: other.companyId } });
  await withServer(async (call) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res: { status: number; body: any } = await call('GET', `/purchase-orders?limit=3${cursor ? `&cursor=${cursor}` : ''}`, a.token);
      assert.equal(res.status, 200);
      assert.ok(res.body.purchaseOrders.length <= 3);
      seen.push(...res.body.purchaseOrders.map((row: { id: string }) => row.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    assert.equal(seen.length, 7);
    assert.equal(new Set(seen).size, 7, 'no duplicates across pages');
  });
});

integration('inventory health: valuation, turns, dead stock - company scoped, uncosted stock is reported not priced', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const mkItem = (company: { companyId: string }, code: string) => prisma.item.create({ data: { code: `${code}-${randomUUID().slice(0, 6)}`, name: code, category: 'Dairy', companyId: company.companyId } });
  const milk = await mkItem(a, 'MILK');
  const rice = await mkItem(a, 'RICE');
  const oil = await mkItem(a, 'OIL');
  const foreign = await mkItem(b, 'FOREIGN');
  const lot = (itemId: string, attributes: object | null) => prisma.lot.create({ data: { itemId, lotNo: `L-${randomUUID().slice(0, 6)}`, attributes: attributes as never } });
  const milkLot = await lot(milk.id, { purchaseRate: 10 });
  const riceLot = await lot(rice.id, { purchaseRate: 20 });
  const oilLot = await lot(oil.id, null);
  const foreignLot = await lot(foreign.id, { purchaseRate: 999 });
  const put = (company: { companyId: string; loc: { id: string } }, itemId: string, lotId: string, onHand: number) => prisma.stockLedger.create({ data: { itemId, lotId, locationId: company.loc.id, onHand, companyId: company.companyId } });
  await put(a, milk.id, milkLot.id, 100);
  await put(a, rice.id, riceLot.id, 10);
  await put(a, oil.id, oilLot.id, 5);
  await put(b, foreign.id, foreignLot.id, 1000);
  await prisma.stockMovement.create({ data: { itemId: milk.id, lotId: milkLot.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -30, beforeBalance: 130, afterBalance: 100, actor: a.userId, timestamp: new Date(), companyId: a.companyId } });
  await withServer(async (call) => {
    const res = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}&windowDays=30`, a.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.valuation.totalValue, 1200, "100 x 10 + 10 x 20; a second company's 999 x 1000 is not included");
    assert.equal(res.body.valuation.unvaluedUnits, 5);
    const status = Object.fromEntries(res.body.items.map((i: { name: string; status: string }) => [i.name, i.status]));
    assert.equal(status.MILK, 'HEALTHY');
    assert.equal(status.RICE, 'DEAD', 'stock on hand and zero sales while other items sold');
    assert.equal(res.body.deadStock.value, 200);
    assert.equal(res.body.turns, 3.04, 'COGS 300 in 30 days, annualised, over value 1200');
    const other = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}`, b.token);
    assert.equal(other.status, 404, 'another company cannot read this location');
  });
});
