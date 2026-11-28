import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { prisma } from '../lib/db.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { generateJWT } from '../lib/otp-auth.js';
import { controlPlane, type ReportDefinition } from '../lib/saas/control-plane.js';
import { enforcePlanEntitlements } from '../lib/saas/entitlements.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { extractToken } from './enterprise-auth.js';
import reportsRouter from './reports.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function fixture() {
  const companyId = `reports-${randomUUID()}`;
  const standard = controlPlane.companies.get('default-company')!;
  controlPlane.companies.set(companyId, { ...standard, id: companyId, name: companyId, planId: 'pro' });
  controlPlane.entitlements.set(companyId, { OMS: true, PURCHASING: true, INVENTORY: true, WMS: true });
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const location = async () => {
    const id = randomUUID();
    return (await prisma.location.create({ data: { id, companyId, code: id, name: id, type: 'warehouse' } })).id;
  };
  const locationId = await location();
  const secondLocationId = await location();
  const user = async (role: 'ADMIN' | 'BRANCH_MANAGER' | 'STORE_USER', locationIds: string[] = []) => {
    const id = randomUUID();
    const email = `${id}@test.invexa.local`;
    await prisma.user.create({ data: { id, companyId, email, name: role, role, passwordHash: 'x', assignedLocations: '[]' } });
    createEnhancedUser({ id, companyId, email, name: role, role, passwordHash: 'x', status: 'active', branchIds: [], locationIds });
    return { id, token: generateJWT(id, companyId) };
  };
  return { companyId, locationId, secondLocationId, user, admin: await user('ADMIN') };
}

async function config(companyId: string, reports: ReportDefinition[], version: number, kind: 'draft' | 'published') {
  const versionId = randomUUID();
  const base = controlPlane.published.get('default-company')!;
  await prisma.controlPlaneConfig.create({ data: {
    companyId, version, versionId, kind, status: kind,
    payload: JSON.parse(JSON.stringify({ ...base, id: versionId, companyId, version, reports })),
  } });
}

async function reportApi(t: TestContext) {
  const app = express();
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope, enforcePlanEntitlements, reportsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return async (token: string, key: string, locationId: string, source: string) => {
    const path = `/api/v1/reports/studio/${source}?${new URLSearchParams({ reportKey: key, locationId })}`;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
}

integration('published order reports apply company and branch scope, typed filters, grouping and output limits in PostgreSQL', async (t) => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const owner = await fixture();
  const foreign = await fixture();
  // These test-only configuration rows have no company rows in the control repository.
  t.after(async () => { await prisma.controlPlaneConfig.deleteMany({ where: { companyId: owner.companyId } }); });
  const assigned = await owner.user('BRANCH_MANAGER', [owner.locationId]);
  const unassigned = await owner.user('BRANCH_MANAGER', [owner.secondLocationId]);
  const store = await owner.user('STORE_USER', [owner.locationId]);
  const oldest = new Date('2026-01-01T00:00:00Z');
  const newest = new Date('2026-02-01T00:00:00Z');
  const draft: ReportDefinition = { key: 'grouped', name: 'Order statuses', entity: 'orders', columns: [],
    filters: { channel: 'POS' }, groupBy: 'status', view: 'bar' };
  const detail: ReportDefinition = { key: 'detail', name: 'Order detail', entity: 'orders', columns: ['order_no', 'created_at'], filters: { status: 'PACKED', lines: 0 } };
  const purchase: ReportDefinition = { key: 'purchase', name: 'Purchase rollup', entity: 'purchase_orders', columns: ['po_no', 'supplier', 'value'], filters: { value: 17.35 } };
  await config(owner.companyId, [draft, detail, purchase], 2, 'draft');
  const orderOf = (f: typeof owner, locationId: string, fields: { externalReference: string; status: string; channel: string; createdAt: Date }) =>
    ({ ...fields, companyId: f.companyId, fulfillmentLocationId: locationId, createdById: f.admin.id, customerName: 'Private customer detail' });
  await prisma.order.createMany({ data: [
    ...Array.from({ length: 2100 }, (_, index) => orderOf(owner, owner.locationId, {
      externalReference: `RECENT-${index}`, status: index < 600 ? 'PACKED' : 'PENDING', channel: 'WEB', createdAt: newest,
    })),
    orderOf(owner, owner.locationId, { externalReference: 'OLD-POS', channel: 'POS', status: 'PACKED', createdAt: oldest }),
    orderOf(owner, owner.secondLocationId, { externalReference: 'OTHER-LOC', channel: 'POS', status: 'PACKED', createdAt: newest }),
    orderOf(foreign, foreign.locationId, { externalReference: 'OTHER-COMPANY', channel: 'POS', status: 'PACKED', createdAt: newest }),
  ] });
  const lineItem = await prisma.item.create({ data: { companyId: owner.companyId, code: randomUUID(), name: 'Order line item' } });
  await prisma.order.create({ data: {
    ...orderOf(owner, owner.locationId, { externalReference: 'WITH-LINE', channel: 'WEB', status: 'PACKED', createdAt: newest }),
    lines: { create: [{ itemId: lineItem.id, requestedQty: 1 }] },
  } });
  const supplier = await prisma.supplier.create({ data: { companyId: owner.companyId, name: 'Local supplier', email: 'private@test.invexa.local' } });
  await prisma.purchaseOrder.create({ data: {
    companyId: owner.companyId, supplierId: supplier.id, locationId: owner.locationId, createdById: owner.admin.id,
    number: 'PO-REPORT', totalAmount: 17.35,
  } });
  await prisma.purchaseOrder.create({ data: {
    companyId: owner.companyId, supplierId: supplier.id, locationId: owner.locationId, createdById: owner.admin.id,
    number: 'PO-OTHER-AMOUNT', totalAmount: 17.36,
  } });

  const run = await reportApi(t);
  const report = (token: string, key: string, locationId = owner.locationId, source = 'orders') => run(token, key, locationId, source);

  assert.equal((await report(owner.admin.token, 'grouped')).status, 404);
  await config(owner.companyId, [draft, detail, purchase], 2, 'published');
  const group = await report(assigned.token, 'grouped');
  assert.equal(group.status, 200, JSON.stringify(group.body));
  assert.equal(group.body.version, 2);
  assert.deepEqual(group.body.rows, [{ Status: 'PACKED', Records: 1 }], 'finds the supported channel after over 2,000 newer orders');
  assert.equal(group.body.chart, true);
  assert.equal((await report(unassigned.token, 'grouped')).status, 403);
  assert.equal((await report(store.token, 'grouped')).status, 403);
  assert.equal((await report(foreign.admin.token, 'grouped')).status, 404);
  assert.equal((await report(foreign.admin.token, 'grouped', foreign.locationId)).status, 404);

  const limited = await report(owner.admin.token, 'detail');
  assert.equal(limited.status, 200, JSON.stringify(limited.body));
  assert.equal(limited.body.total, 601);
  assert.equal(limited.body.rows.length, 500);
  assert.equal(limited.body.truncated, true);
  assert.deepEqual(Object.keys(limited.body.rows[0]), ['Order no.', 'Created']);
  assert.equal(limited.body.rows[0].Created, newest.toISOString());
  assert.deepEqual((await report(owner.admin.token, 'detail')).body.rows, limited.body.rows);

  const purchases = await report(owner.admin.token, 'purchase', owner.locationId, 'purchase-orders');
  assert.equal(purchases.status, 200, JSON.stringify(purchases.body));
  assert.deepEqual(purchases.body.rows, [{ 'PO no.': 'PO-REPORT', Supplier: 'Local supplier', Value: 17.35 }]);
  const buyerReport = () => report(assigned.token, 'purchase', owner.locationId, 'purchase-orders');
  assert.equal((await buyerReport()).status, 200);
  const permission = await prisma.permission.upsert({
    where: { module_action: { module: 'PURCHASE', action: 'VIEW' } },
    update: {},
    create: { module: 'PURCHASE', action: 'VIEW' },
  });
  await prisma.userPermission.create({
    data: { userId: assigned.id, permissionId: permission.id, allowed: false, denied: true, scopeId: owner.locationId },
  });
  const denied = await buyerReport();
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'PERMISSION_DENIED');
  assert.equal((await report(owner.admin.token, 'purchase')).status, 404, 'a report cannot be run through a different dataset route');
  controlPlane.entitlements.set(owner.companyId, { OMS: false, PURCHASING: true });
  assert.equal((await report(owner.admin.token, 'grouped')).status, 403);
  controlPlane.entitlements.set(owner.companyId, { OMS: true, PURCHASING: true });
  await config(owner.companyId, [], 3, 'published');
  assert.equal((await report(owner.admin.token, 'grouped')).status, 404, 'the current release no longer allows the report');
});

integration('inventory, count and transfer reports use scoped database rows and preserve report values', async (t) => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const owner = await fixture();
  const foreign = await fixture();
  t.after(async () => { await prisma.controlPlaneConfig.deleteMany({ where: { companyId: owner.companyId } }); });
  const assigned = await owner.user('BRANCH_MANAGER', [owner.locationId]);
  const store = await owner.user('STORE_USER', [owner.locationId]);
  await config(owner.companyId, [
    { key: 'stock', name: 'Staple stock', entity: 'inventory', columns: ['item_code', 'physical', 'available', 'quarantine'], filters: { category: 'Staples' } },
    { key: 'counts', name: 'Approved counts', entity: 'counts', columns: ['item_code', 'variance', 'status'], filters: { status: 'Approved' } },
    { key: 'transfers', name: 'Open transfers', entity: 'transfers', columns: ['transfer_no', 'from', 'to', 'items'], filters: { status: 'REQUESTED' } },
  ], 2, 'published');
  const item = await prisma.item.create({ data: { companyId: owner.companyId, code: 'RICE', name: 'Rice', category: 'Staples' } });
  const archive = await prisma.item.create({ data: { companyId: owner.companyId, code: 'OLD', name: 'Old rice', category: 'Staples', status: 'ARCHIVED' } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'A' } });
  const lotB = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'B' } });
  const archivedLot = await prisma.lot.create({ data: { itemId: archive.id, lotNo: 'OLD' } });
  await prisma.stockLedger.createMany({ data: [
    { companyId: owner.companyId, itemId: item.id, lotId: lot.id, locationId: owner.locationId, onHand: 10, reserved: 2, quarantine: 3 },
    { companyId: owner.companyId, itemId: archive.id, lotId: archivedLot.id, locationId: owner.locationId, onHand: 5 },
    { companyId: owner.companyId, itemId: item.id, lotId: lot.id, locationId: owner.secondLocationId, onHand: 99 },
  ] });
  await prisma.stockCount.createMany({ data: [
    { companyId: owner.companyId, itemId: item.id, lotId: lot.id, locationId: owner.locationId,
      submittedById: owner.admin.id, reviewStatus: 'APPROVED', physicalQty: 7.25, bookQty: 8.3 },
    { companyId: owner.companyId, itemId: item.id, lotId: lotB.id, locationId: owner.locationId,
      submittedById: owner.admin.id, reviewStatus: 'REJECTED', physicalQty: 1, bookQty: 2 },
    { companyId: owner.companyId, itemId: item.id, lotId: lot.id, locationId: owner.secondLocationId,
      submittedById: owner.admin.id, reviewStatus: 'APPROVED', physicalQty: 100, bookQty: 0 },
  ] });
  const transfer = await prisma.transfer.create({ data: {
    companyId: owner.companyId, sourceLocationId: owner.locationId, destinationLocationId: owner.secondLocationId,
    requestedById: owner.admin.id, lines: { create: [lot, lotB].map((entry) => ({ itemId: item.id, lotId: entry.id, requestedQty: 1 })) },
  } });
  const incoming = await prisma.transfer.create({ data: {
    companyId: foreign.companyId, sourceLocationId: foreign.locationId, destinationLocationId: owner.locationId,
    requestedById: foreign.admin.id,
  } });
  await prisma.transfer.create({ data: {
    companyId: foreign.companyId, sourceLocationId: foreign.locationId, destinationLocationId: foreign.secondLocationId,
    requestedById: foreign.admin.id,
  } });

  const run = await reportApi(t);
  const stock = await run(assigned.token, 'stock', owner.locationId, 'stock');
  assert.equal(stock.status, 200, JSON.stringify(stock.body));
  assert.deepEqual(stock.body.rows, [{ 'Item code & name': 'RICE · Rice', 'Total physical': 10, Available: 8, Quarantine: 3 }]);
  assert.equal((await run(owner.admin.token, 'stock', owner.locationId, 'stock')).body.total, 2, 'admins can still see archived stock');
  assert.equal((await run(assigned.token, 'stock', owner.secondLocationId, 'stock')).status, 403);
  assert.equal((await run(foreign.admin.token, 'stock', owner.locationId, 'stock')).status, 404);
  assert.equal((await run(store.token, 'counts', owner.locationId, 'counts')).status, 403, 'blind counts stay blind');

  const counts = await run(assigned.token, 'counts', owner.locationId, 'counts');
  assert.equal(counts.status, 200, JSON.stringify(counts.body));
  assert.deepEqual(counts.body.rows, [{ Item: 'RICE · Rice', Difference: -1.05, Status: 'Approved' }]);
  const transfers = await run(assigned.token, 'transfers', owner.locationId, 'transfers');
  assert.equal(transfers.status, 200, JSON.stringify(transfers.body));
  assert.deepEqual(transfers.body.rows.find((row: Record<string, unknown>) => row['Transfer no.'] === transfer.id),
    { 'Transfer no.': transfer.id, From: owner.locationId, To: '', Items: 1 });
  assert.deepEqual(transfers.body.rows.find((row: Record<string, unknown>) => row['Transfer no.'] === incoming.id),
    { 'Transfer no.': incoming.id, From: '', To: owner.locationId, Items: 0 });
  assert.equal(transfers.body.total, 2);
  const adminTransfers = await run(owner.admin.token, 'transfers', owner.locationId, 'transfers');
  assert.equal(adminTransfers.body.rows.find((row: Record<string, unknown>) => row['Transfer no.'] === transfer.id).To, owner.secondLocationId);
});

integration('stock reports value each lot at its recorded cost and leave unpriced lots blank', async (t) => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const owner = await fixture();
  t.after(async () => { await prisma.controlPlaneConfig.deleteMany({ where: { companyId: owner.companyId } }); });
  const item = await prisma.item.create({ data: { companyId: owner.companyId, code: 'RICE', name: 'Rice' } });
  const lotInputs = [
    { lotNo: 'LANDED', onHand: 10, attributes: { landedUnitCost: '12.345', purchaseRate: 1 } },
    { lotNo: 'PURCHASE', onHand: 3.3, attributes: { landedUnitCost: '1e9999', purchaseRate: ' 2.5e0 ' } },
    { lotNo: 'UNPRICED', onHand: 9, attributes: { landedUnitCost: true, purchaseValue: 50 } },
    { lotNo: 'ZERO', onHand: 0, attributes: { purchaseRate: 4 } },
    { lotNo: 'ROUND', onHand: 0.5, attributes: { purchaseRate: 0.01 } },
  ];
  for (const { lotNo, onHand, attributes } of lotInputs) {
    const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo, attributes } });
    await prisma.stockLedger.create({ data: {
      companyId: owner.companyId, locationId: owner.locationId, itemId: item.id, lotId: lot.id,
      onHand, reserved: Math.min(onHand, 2), quarantine: 3,
    } });
  }
  const reports: ReportDefinition[] = [
    { key: 'values', name: 'Stock value by lot', entity: 'inventory', columns: ['lot_no', 'value'], filters: {} },
    { key: 'matching', name: 'Stock value of 8.25', entity: 'inventory', columns: ['lot_no', 'value'], filters: { value: 8.25 } },
    { key: 'zeros', name: 'Zero value records', entity: 'inventory', columns: ['lot_no', 'value'], filters: { value: 0 } },
  ];
  await config(owner.companyId, reports, 2, 'published');
  const run = await reportApi(t);
  const request = (key: string) => run(owner.admin.token, key, owner.locationId, 'stock');
  const list = await request('values');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(Object.fromEntries(list.body.rows.map((row: Record<string, unknown>) => [row.Lot, row.Value])), {
    LANDED: 123.45, PURCHASE: 8.25, UNPRICED: '', ZERO: 0, ROUND: 0.01,
  });
  assert.deepEqual((await request('matching')).body.rows, [{ Lot: 'PURCHASE', Value: 8.25 }]);
  assert.deepEqual((await request('zeros')).body.rows, [{ Lot: 'ZERO', Value: 0 }]);
  const blind = await owner.user('STORE_USER', [owner.locationId]);
  assert.equal((await run(blind.token, 'values', owner.locationId, 'stock')).status, 403);
});
