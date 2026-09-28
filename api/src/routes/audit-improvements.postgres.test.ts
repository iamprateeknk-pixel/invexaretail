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
    assert.equal(res.body.service.orders, 0, 'no orders decided in this window');
    assert.equal(res.body.service.orderFillRatePercent, null);
    const status = Object.fromEntries(res.body.items.map((i: { name: string; status: string }) => [i.name, i.status]));
    assert.equal(status.MILK, 'HEALTHY');
    assert.equal(status.RICE, 'DEAD', 'stock on hand and zero sales while other items sold');
    assert.equal(res.body.deadStock.value, 200);
    assert.equal(res.body.turns, 3.04, 'COGS 300 in 30 days, annualised, over value 1200');
    const other = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}`, b.token);
    assert.equal(other.status, 404, 'another company cannot read this location');
  });
});

integration('reorder suggestions are derived from sales history, tenant scoped, and skip items with no demand', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const sold = await prisma.item.create({ data: { code: `SUG-${randomUUID().slice(0, 8)}`, name: 'Sold', companyId: a.companyId } });
  const idle = await prisma.item.create({ data: { code: `IDL-${randomUUID().slice(0, 8)}`, name: 'Idle', companyId: a.companyId } });
  const lot = await prisma.lot.create({ data: { itemId: sold.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  for (let d = 1; d <= 20; d += 1) {
    await prisma.stockMovement.create({ data: { itemId: sold.id, lotId: lot.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -10, beforeBalance: 500, afterBalance: 490, actor: a.userId, timestamp: new Date(Date.now() - d * 86_400_000), companyId: a.companyId } });
  }
  await withServer(async (call) => {
    const res = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const ids = res.body.suggestions.map((s: { itemId: string }) => s.itemId);
    assert.ok(ids.includes(sold.id));
    assert.ok(!ids.includes(idle.id), 'no demand history: no suggestion');
    const s = res.body.suggestions.find((x: { itemId: string }) => x.itemId === sold.id);
    assert.equal(s.change, 'NEW');
    assert.ok(s.suggestedMin > 0 && s.suggestedTarget >= s.suggestedMin);
    assert.equal((await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}`, b.token)).status, 404);
  });
});

integration('company timezone can be read, set by an admin, rejected when invalid, and is per company (audit T-2)', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  await withServer(async (call) => {
    assert.equal((await call('PUT', '/company/timezone', a.token, { timezone: 'Not/AZone' })).status, 400);
    assert.equal((await call('PUT', '/company/timezone', a.token, {})).status, 400);
    const set = await call('PUT', '/company/timezone', a.token, { timezone: 'America/New_York' });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal((await call('GET', '/company/timezone', a.token)).body.timezone, 'America/New_York');
    assert.equal((await call('GET', '/company/timezone', b.token)).body.timezone, 'Asia/Kolkata', 'another company is unaffected');
    assert.equal((await prisma.companyProfile.findUniqueOrThrow({ where: { id: a.companyId } }) as { timezone?: string | null }).timezone, 'America/New_York');
    assert.equal((await call('PUT', '/company/timezone', a.token, { timezone: null })).status, 200);
    assert.equal((await call('GET', '/company/timezone', a.token)).body.timezone, 'Asia/Kolkata');
  });
});

integration('forecast excludes stockout days from demand, and reorder rules keep a case pack that the plan rounds to (audit O-2/O-4)', async () => {
  const a = await makeCompany();
  const item = await prisma.item.create({ data: { code: `CEN-${randomUUID().slice(0, 8)}`, name: 'Censor', companyId: a.companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'L' } });
  const day = 86_400_000;
  const mv = (ago: number, type: string, delta: number, before: number, after: number) => prisma.stockMovement.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, movementType: type as never, qtyDelta: delta, beforeBalance: before, afterBalance: after, actor: a.userId, timestamp: new Date(Date.now() - ago * day - 3_600_000), companyId: a.companyId } });
  // 10-day window: received 10 on day -9, sold 10 on the same day (empty afterwards), restocked 20 on day -2, sold 2 on day -1.
  await mv(9, 'PURCHASE_RECEIPT', 10, 0, 10);
  await mv(9, 'SALES_DEDUCTION', -10, 10, 0);
  await mv(2, 'PURCHASE_RECEIPT', 20, 0, 20);
  await mv(1, 'SALES_DEDUCTION', -2, 20, 18);
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, onHand: 18, companyId: a.companyId } });
  await withServer(async (call) => {
    const forecast = await call('GET', `/items/${item.id}/forecast?locationId=${a.loc.id}&windowDays=10`, a.token);
    assert.equal(forecast.status, 200, JSON.stringify(forecast.body));
    assert.ok(forecast.body.stockoutDaysExcluded >= 5, `days with an empty shelf must be excluded, got ${forecast.body.stockoutDaysExcluded}`);

    const put = await call('PUT', `/reorder-rules/${item.id}`, a.token, { locationId: a.loc.id, minQty: 5, targetQty: 20, orderMultiple: 12 });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.rule.orderMultiple, 12);
    assert.equal((await call('PUT', `/reorder-rules/${item.id}`, a.token, { locationId: a.loc.id, minQty: 5, targetQty: 20, orderMultiple: -3 })).status, 400);
  });
});

integration('tags and custom fields are per company: same name allowed in two companies, no cross-company read, tag or write (audit T-1)', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const itemA = await prisma.item.create({ data: { code: `TG-${randomUUID().slice(0, 8)}`, name: 'A item', companyId: a.companyId } });
  const name = `Fresh-${randomUUID().slice(0, 6)}`;
  await withServer(async (call) => {
    const tagA = await call('POST', '/catalog/tags', a.token, { name });
    assert.equal(tagA.status, 201, JSON.stringify(tagA.body));
    assert.equal((await call('POST', '/catalog/tags', b.token, { name })).status, 201, 'the same name is free in another company');
    assert.equal((await call('POST', '/catalog/tags', a.token, { name })).status, 409, 'but unique inside one company');
    assert.deepEqual((await call('GET', '/catalog/tags', a.token)).body.tags.map((t: { name: string }) => t.name), [name]);

    assert.equal((await call('PUT', `/catalog/items/${itemA.id}/tags`, b.token, { tagIds: [] })).status, 404, "B cannot tag A's item");
    const bTag = (await call('GET', '/catalog/tags', b.token)).body.tags[0];
    assert.equal((await call('PUT', `/catalog/items/${itemA.id}/tags`, a.token, { tagIds: [bTag.id] })).status, 404, "A cannot use B's tag");
    assert.equal((await call('PUT', `/catalog/items/${itemA.id}/tags`, a.token, { tagIds: [tagA.body.tag.id] })).status, 200);
    assert.equal((await call('GET', `/catalog/items/${itemA.id}`, b.token)).status, 404);

    const field = await call('POST', '/catalog/custom-fields', a.token, { name: 'Batch note' });
    assert.equal(field.status, 201, JSON.stringify(field.body));
    assert.equal((await call('POST', '/catalog/custom-fields', b.token, { name: 'Batch note' })).status, 201);
    assert.equal((await call('GET', '/catalog/custom-fields', b.token)).body.fields.length, 1);
    assert.equal((await call('PUT', `/catalog/items/${itemA.id}/custom-fields/${field.body.field.id}`, b.token, { value: 'x' })).status, 404);
    assert.equal((await call('PUT', `/catalog/items/${itemA.id}/custom-fields/${field.body.field.id}`, a.token, { value: 'x' })).status, 200);
  });
});

integration('an order with a customer minimum shelf life is filled from the fresher lot; manufacturing date is company scoped (audit S-1)', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const item = await prisma.item.create({ data: { code: `RSL-${randomUUID().slice(0, 8)}`, name: 'Yogurt', shelfLifeDays: 100, companyId: a.companyId } });
  const day = 86_400_000;
  const old = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'OLD', expiryDate: new Date(Date.now() + 10 * day) } });
  const fresh = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'FRESH', expiryDate: new Date(Date.now() + 80 * day) } });
  for (const lot of [old, fresh]) await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, onHand: 20, companyId: a.companyId } });
  await withServer(async (call) => {
    const res = await call('POST', '/orders', a.token, { channel: 'B2B', fulfillmentLocationId: a.loc.id, lines: [{ itemId: item.id, quantity: 5, minRslPercent: 50 }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const lotIds = (res.body.order?.lines ?? []).map((l: { lotId: string }) => l.lotId);
    assert.deepEqual(lotIds, [fresh.id], 'the 10%-RSL lot is skipped for a 50% customer');

    assert.equal((await call('PATCH', `/lots/${fresh.id}/manufactured`, b.token, { manufacturedAt: '2026-01-01' })).status, 404, "another company cannot edit this lot");
    assert.equal((await call('PATCH', `/lots/${fresh.id}/manufactured`, a.token, { manufacturedAt: '2999-01-01' })).status, 400);
    const ok = await call('PATCH', `/lots/${fresh.id}/manufactured`, a.token, { manufacturedAt: '2026-01-01' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
});

integration('demand includes sales imported through the legacy daily import (InventoryMovement), not only StockMovement (audit O-2)', async () => {
  const a = await makeCompany();
  const item = await prisma.item.create({ data: { code: `LEG-${randomUUID().slice(0, 8)}`, name: 'Legacy sold', companyId: a.companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'L' } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, onHand: 100, companyId: a.companyId } });
  for (let d = 1; d <= 20; d += 1) {
    await prisma.inventoryMovement.create({ data: {
      id: randomUUID(), dedupeKey: `legacy-${randomUUID()}`, itemId: item.id, lotId: lot.id, locationId: a.loc.id,
      movementType: 'SALE_OUT', qtyDelta: -6, transactionAt: new Date(Date.now() - d * 86_400_000), sourceType: 'SALES', sourceReference: `inv-${d}`, createdById: a.userId,
    } });
  }
  await withServer(async (call) => {
    const suggestions = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
    assert.equal(suggestions.status, 200, JSON.stringify(suggestions.body));
    const s = suggestions.body.suggestions.find((x: { itemId: string }) => x.itemId === item.id);
    assert.ok(s, 'legacy-import sales must produce demand and therefore a suggestion');
    assert.ok(s.averageDailyDemand > 1, `saw ${s.averageDailyDemand}`);
    const forecast = await call('GET', `/items/${item.id}/forecast?locationId=${a.loc.id}&windowDays=30`, a.token);
    assert.equal(forecast.status, 200, JSON.stringify(forecast.body));
    assert.ok(forecast.body.demand.averageDailyDemand > 1, `forecast saw ${forecast.body.demand.averageDailyDemand}`);
    const health = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}&windowDays=30`, a.token);
    assert.equal(health.body.items.find((i: { name: string }) => i.name === 'Legacy sold').status, 'HEALTHY');
  });
});

integration('count accuracy breakdown is tolerance-based, value-weighted and tenant scoped (audit C-3)', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const item = await prisma.item.create({ data: { code: `ACC-${randomUUID().slice(0, 8)}`, name: 'Counted', companyId: a.companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'L', attributes: { purchaseRate: 10 } } });
  const mk = (physicalQty: number, bookQty: number) => prisma.stockCount.create({ data: { id: `acc-${randomUUID()}`, itemId: item.id, lotId: lot.id, locationId: a.loc.id, physicalQty, bookQty, submittedById: a.userId, reviewStatus: 'APPROVED', companyId: a.companyId } as never });
  await mk(100, 100); await mk(96, 100); await mk(50, 100);
  await withServer(async (call) => {
    const res = await call('GET', '/reports/count-accuracy-breakdown', a.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.counts, 3);
    assert.equal(res.body.withinTolerance, 2, '4 off on 100 is inside 10%; 50 off is not');
    assert.equal(res.body.varianceValue, 540);
    const other = await call('GET', '/reports/count-accuracy-breakdown', b.token);
    assert.equal(other.body.counts, 0, 'another company sees none of these counts');
  });
});

integration('reorder suggestions can be accepted (writes the rule) or dismissed (drops from the list for 24h), tenant scoped (audit O-1)', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const item = await prisma.item.create({ data: { code: `ACPT-${randomUUID().slice(0, 8)}`, name: 'Accept me', companyId: a.companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  for (let d = 1; d <= 20; d += 1) {
    await prisma.stockMovement.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -8, beforeBalance: 500, afterBalance: 492, actor: a.userId, timestamp: new Date(Date.now() - d * 86_400_000), companyId: a.companyId } });
  }
  await withServer(async (call) => {
    const before = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
    const suggested = before.body.suggestions.find((s: { itemId: string }) => s.itemId === item.id);
    assert.ok(suggested, 'must have a suggestion before accepting');

    assert.equal((await call('POST', `/reorder-rules/suggestions/${item.id}/accept`, b.token, { locationId: a.loc.id })).status, 404, "another company cannot accept A's suggestion");

    const accepted = await call('POST', `/reorder-rules/suggestions/${item.id}/accept`, a.token, { locationId: a.loc.id, windowDays: 30, leadTimeDays: 5 });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.rule.minQty, suggested.suggestedMin);
    assert.equal(accepted.body.rule.targetQty, suggested.suggestedTarget);
    const stored = await prisma.reorderRule.findUniqueOrThrow({ where: { itemId_locationId: { itemId: item.id, locationId: a.loc.id } } });
    assert.equal(stored.minQty, suggested.suggestedMin);

    const after = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
    assert.equal(after.body.suggestions.some((s: { itemId: string }) => s.itemId === item.id), false, 'the rule now matches the suggestion, so it is no longer NEW/INCREASE/DECREASE');

    const item2 = await prisma.item.create({ data: { code: `DISM-${randomUUID().slice(0, 8)}`, name: 'Dismiss me', companyId: a.companyId } });
    const lot2 = await prisma.lot.create({ data: { itemId: item2.id, lotNo: `L2-${randomUUID().slice(0, 6)}` } });
    for (let d = 1; d <= 20; d += 1) {
      await prisma.stockMovement.create({ data: { itemId: item2.id, lotId: lot2.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -4, beforeBalance: 200, afterBalance: 196, actor: a.userId, timestamp: new Date(Date.now() - d * 86_400_000), companyId: a.companyId } });
    }
    const beforeDismiss = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
    assert.ok(beforeDismiss.body.suggestions.some((s: { itemId: string }) => s.itemId === item2.id));
    const dismiss = await call('POST', `/intelligence/${a.loc.id}/dismiss`, a.token, { type: 'REORDER_SUGGESTION', itemId: item2.id, reason: 'already ordering more manually' });
    assert.equal(dismiss.status, 201, JSON.stringify(dismiss.body));
    const afterDismiss = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
    assert.equal(afterDismiss.body.suggestions.some((s: { itemId: string }) => s.itemId === item2.id), false, 'dismissed suggestion must not resurface immediately');
  });
});

integration('supplier price breaks: validated, tenant scoped, and the purchase plan uses them (audit O-4)', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const supplier = await prisma.supplier.create({ data: { name: `PB-${randomUUID()}`, companyId: a.companyId } as never });
  const item = await prisma.item.create({ data: { code: `PB-${randomUUID().slice(0, 8)}`, name: 'Break item', companyId: a.companyId } });
  await withServer(async (call) => {
    const path = `/suppliers/${supplier.id}/price-breaks/${item.id}`;
    assert.equal((await call('PUT', path, a.token, { breaks: [{ minQty: 10, unitCost: 5 }, { minQty: 50, unitCost: 6 }] })).status, 400, 'a bigger quantity must cost less');
    assert.equal((await call('PUT', path, a.token, { breaks: [{ minQty: 0, unitCost: 5 }] })).status, 400);
    assert.equal((await call('PUT', path, b.token, { breaks: [{ minQty: 100, unitCost: 5.9 }] })).status, 404, "another company cannot set this supplier's breaks");
    const ok = await call('PUT', path, a.token, { breaks: [{ minQty: 100, unitCost: 5.9 }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const list = await call('GET', `/suppliers/${supplier.id}/price-breaks`, a.token);
    assert.equal(list.body.priceBreaks.length, 1);
    assert.equal((await call('GET', `/suppliers/${supplier.id}/price-breaks`, b.token)).status, 404);
  });
});
