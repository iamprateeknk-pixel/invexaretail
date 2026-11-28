import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
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
  controlPlane.entitlements.set(companyId, { OMS: true, PURCHASING: true });
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

  const app = express();
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope, enforcePlanEntitlements, reportsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}/api/v1/reports/studio`;
  async function report(token: string, key: string, locationId = owner.locationId, source = 'orders') {
    const url = `${origin}/${source}?${new URLSearchParams({ reportKey: key, locationId })}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

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
