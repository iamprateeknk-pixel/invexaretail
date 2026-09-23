import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail, createEnhancedUser } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import itemMasterRouter from './item-master.js';
import coreRouter from './core.js';
import transfersRouter from './transfers.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  if (!findUserByEmail('adminuser@retail.local')) {
    createEnhancedUser({
      id: 'user-adminuser-1', companyId: 'default-company', email: 'adminuser@retail.local', name: 'Admin User', role: 'ADMIN_USER',
      branchIds: [], locationIds: ['loc-1'], passwordHash: hashPassword('x'), status: 'active',
    });
  }
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', itemMasterRouter);
  app.use('/api/v1', transfersRouter);
  app.use('/api/v1', coreRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call: Api = async (method, path, token, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase();

test('an item can be created and edited with the full master, with versioning and identity checks', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const tag = unique();
    const created = await call('POST', '/items', admin, {
      code: `M-${tag}`, name: 'Master item', barcode: `89${tag}`, hsn: '1006', gstRate: 5, mrp: 99.5, leadTimeDays: 4, shelfLifeDays: 180,
      aliases: [`ERP-${tag}`, 'Master Item Alt'],
    });
    assert.equal(created.status, 201);
    const item = created.body.item;
    assert.deepEqual([item.status, item.version, item.hsn, item.gstRate, item.mrp, item.barcode], ['ACTIVE', 1, '1006', 5, 99.5, `89${tag}`]);
    assert.deepEqual(item.aliases, [`ERP-${tag}`, 'Master Item Alt']);
    assert.equal(item.createdById, 'user-admin-1');

    // Codes, barcodes and aliases live in one namespace.
    assert.equal((await call('POST', '/items', admin, { code: `ERP-${tag}`, name: 'Clash by code' })).status, 409);
    assert.equal((await call('POST', '/items', admin, { code: `N-${tag}`, name: 'Clash', barcode: `89${tag}` })).status, 409);
    assert.equal((await call('POST', '/items', admin, { code: `N2-${tag}`, name: 'Clash', aliases: [`m-${tag}`] })).status, 409);
    // Bad values are rejected, not stored.
    assert.equal((await call('POST', '/items', admin, { code: `B-${tag}`, name: 'Bad', gstRate: 150 })).status, 400);

    const edited = await call('PUT', `/items/${item.id}`, admin, { mrp: 105, hsn: null, aliases: [] });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.item.version, 2);
    assert.equal(edited.body.item.mrp, 105);
    assert.equal(edited.body.item.hsn, undefined);
    assert.equal(edited.body.item.gstRate, 5, 'fields not in the request are left alone');
    assert.equal(edited.body.item.aliases, undefined);

    // The edit is stored, not just echoed back: later reads see it.
    const listed = (await call('GET', '/items', admin)).body.items.find((row: { id: string }) => row.id === item.id);
    assert.deepEqual([listed.version, listed.mrp, listed.gstRate, listed.barcode], [2, 105, 5, `89${tag}`]);
    assert.equal(listed.hsn, undefined);
    assert.equal(listed.aliases, undefined);
    // ... including the name, and archiving builds on the saved version.
    await call('PUT', `/items/${item.id}`, admin, { name: 'Renamed master item', countMethod: 'ITEM_WEIGHT' });
    const renamed = (await call('GET', '/items', admin)).body.items.find((row: { id: string }) => row.id === item.id);
    assert.deepEqual([renamed.name, renamed.countMethod, renamed.version], ['Renamed master item', 'ITEM_WEIGHT', 3]);
    const archived = await call('PATCH', `/items/${item.id}/status`, admin, { status: 'ARCHIVED', reason: 'test cleanup' });
    assert.equal(archived.body.item.version, 4);
  });
});

test('archiving hides an item from operations, blocks new transactions, and is fully reversible', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const store = tokenFor('store@retail.local');
    const picker = tokenFor('picker@retail.local');
    const target = 'item-1002';

    assert.equal((await call('PATCH', `/items/${target}/status`, admin, { status: 'ARCHIVED' })).status, 400);
    assert.equal((await call('PATCH', `/items/${target}/status`, store, { status: 'ARCHIVED', reason: 'no longer sold' })).status, 403);
    const archived = await call('PATCH', `/items/${target}/status`, admin, { status: 'ARCHIVED', reason: 'no longer sold' });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.item.archiveReason, 'no longer sold');
    assert.equal(archived.body.item.archivedById, 'user-admin-1');
    assert.equal(archived.body.item.version, 2);

    const ids = async (token: string, query = '') => (await call('GET', `/items${query}`, token)).body.items.map((row: { id: string }) => row.id);
    // Operational roles never see it, whatever they ask for; admins find it on request.
    assert.equal((await ids(store)).includes(target), false);
    assert.equal((await ids(picker, '?status=all')).includes(target), false);
    assert.equal((await ids(admin)).includes(target), false);
    assert.equal((await ids(admin, '?status=ARCHIVED')).includes(target), true);
    assert.equal((await ids(admin, '?status=all')).includes(target), true);
    assert.equal((await call('GET', '/items?status=bogus', admin)).status, 400);

    // Its stock disappears for the store user but not for the admin.
    const storeStock = (await call('GET', '/stock/loc-1', store)).body.items;
    assert.equal(storeStock.some((row: { itemId: string }) => row.itemId === target), false);
    const adminStock = (await call('GET', '/stock/loc-1', admin)).body.items;
    assert.equal(adminStock.some((row: { itemId: string }) => row.itemId === target), true);

    // No new transactions against it.
    const assign = await call('POST', '/count-assignments', admin, { locationId: 'loc-1', storeUserId: 'user-store-1', itemIds: [target] });
    assert.equal(assign.status, 400);
    assert.match(assign.body.message, /archived/);
    const count = await call('POST', '/stock-counts', admin, { itemId: target, locationId: 'loc-1', physicalQuantity: 1, mode: 'manual' });
    assert.equal(count.status, 400);
    assert.match(count.body.message, /archived/);
    const transfer = await call('POST', '/transfers', admin, {
      sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: [{ itemId: target, lotId: 'lot-1002', quantity: 1 }],
    });
    assert.equal(transfer.status, 400);
    assert.match(transfer.body.message, /archived/);

    const restored = await call('PATCH', `/items/${target}/status`, admin, { status: 'ACTIVE' });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.item.archiveReason, undefined);
    assert.equal((await ids(store)).includes(target), true);
    const assignAgain = await call('POST', '/count-assignments', admin, { locationId: 'loc-1', storeUserId: 'user-store-1', itemIds: [target] });
    assert.equal(assignAgain.status, 201);
  });
});

test('permanent delete is only for an item with no history, and only for the Main Admin', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const adminUser = tokenFor('adminuser@retail.local');
    const tag = unique();

    const fresh = (await call('POST', '/items', admin, { code: `D-${tag}`, name: 'Never used' })).body.item;
    const refs = await call('GET', `/items/${fresh.id}/references`, admin);
    assert.equal(refs.status, 200);
    assert.equal(refs.body.canDelete, true);

    assert.equal((await call('DELETE', `/items/${fresh.id}`, adminUser)).status, 403);
    assert.equal((await call('DELETE', `/items/${fresh.id}`, tokenFor('store@retail.local'))).status, 403);
    assert.equal((await call('DELETE', `/items/${fresh.id}`, admin)).status, 204);
    const after = (await call('GET', '/items?status=all', admin)).body.items;
    assert.equal(after.some((row: { id: string }) => row.id === fresh.id), false);
    assert.equal((await call('DELETE', `/items/${fresh.id}`, admin)).status, 404);

    // An item with stock, counts and movements must be archived instead.
    const used = await call('DELETE', '/items/item-1001', admin);
    assert.equal(used.status, 409);
    assert.match(used.body.message, /Archive it instead/);
    assert.ok(used.body.blockers.some((row: { key: string }) => row.key === 'stock'));
    const usedRefs = await call('GET', '/items/item-1001/references', admin);
    assert.equal(usedRefs.body.canDelete, false);
    // ... and it is still there.
    assert.ok((await call('GET', '/items', admin)).body.items.some((row: { id: string }) => row.id === 'item-1001'));
  });
});
