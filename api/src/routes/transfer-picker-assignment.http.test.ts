// Transfer picker assignment and the transfer notifications: an admin hands a queued
// transfer to one named picker (only that picker can then see and pick it), the picker is
// told, and the destination store's users are told when the goods are dispatched.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser, seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { createTransferRecord, findTransferForCompany } from '../lib/repository.js';
import { memoryNotifications, transferReceiverIds, isEligiblePicker } from '../lib/transfer-assignment.js';
import { extractToken } from './enterprise-auth.js';
import logisticsRouter from './transfer-logistics.js';
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
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', logisticsRouter);
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

const unique = () => Math.random().toString(36).slice(2, 8);

function queuedTransfer(status: 'REQUESTED' | 'CONFIRMED' = 'REQUESTED') {
  const id = `tr-${unique()}`;
  createTransferRecord({
    id, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status,
    lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 4 }],
    createdAt: new Date().toISOString(),
  });
  return id;
}

// A second picker at the same warehouse, so "the other picker" exists.
function secondPicker(): { id: string; email: string } {
  const email = `picker2-${unique()}@retail.local`;
  const companyId = findUserByEmail('picker@retail.local')!.companyId;
  const user = createEnhancedUser({
    companyId, email, name: 'Second Picker', role: 'WAREHOUSE_PICKER', branchIds: [], locationIds: ['wh-1'],
    passwordHash: hashPassword('ChangeMe123!'), status: 'active',
  });
  return { id: user.id, email };
}

test('an admin assigns a named picker: only that picker can see and pick it, and they are notified', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const picker = tokenFor('picker@retail.local');
    const pickerId = findUserByEmail('picker@retail.local')!.id;
    const other = secondPicker();
    const otherToken = tokenFor(other.email);
    const id = queuedTransfer();

    const eligible = await call('GET', `/transfers/${id}/eligible-pickers`, admin);
    assert.equal(eligible.status, 200);
    assert.deepEqual(eligible.body.pickers.map((entry: any) => entry.id).sort(), [pickerId, other.id].sort());

    const before = memoryNotifications.length;
    const assigned = await call('PATCH', `/transfers/${id}/picker`, admin, { pickerId });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.transfer.assignedPickerId, pickerId);
    const notice = memoryNotifications.slice(before);
    assert.equal(notice.length, 1);
    assert.equal(notice[0].userId, pickerId);
    assert.equal(notice[0].type, 'transfer.pick_assigned');
    assert.match(notice[0].body, new RegExp(id));

    // The assigned picker sees it; the other picker no longer does, and cannot open or pick it.
    const mine = await call('GET', '/picker-tasks', picker);
    assert.ok(mine.body.tasks.some((task: any) => task.transferId === id && task.assignedToMe));
    const theirs = await call('GET', '/picker-tasks', otherToken);
    assert.ok(!theirs.body.tasks.some((task: any) => task.transferId === id));
    assert.ok(!(await call('GET', '/transfers/list', otherToken)).body.transfers.some((transfer: any) => transfer.id === id));
    assert.equal((await call('GET', `/picker/transfers/${id}`, otherToken)).status, 403);
    const blocked = await call('POST', `/picker/transfers/${id}/pick-slips`, otherToken, {
      lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1, inputMethod: 'MANUAL' }],
    });
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.message, /another picker/);
    assert.equal((await call('GET', `/picker/transfers/${id}`, picker)).status, 200);

    // The admin's list shows who has it.
    const listed = (await call('GET', '/transfers/list', admin)).body.transfers.find((transfer: any) => transfer.id === id);
    assert.equal(listed.assignedPickerName, findUserByEmail('picker@retail.local')!.name);

    // Unassigning puts it back in every picker's queue, without a notification.
    const mark = memoryNotifications.length;
    assert.equal((await call('PATCH', `/transfers/${id}/picker`, admin, { pickerId: null })).status, 200);
    assert.equal(memoryNotifications.length, mark);
    assert.ok((await call('GET', '/picker-tasks', otherToken)).body.tasks.some((task: any) => task.transferId === id));
  });
});

test('only transfer managers assign, only eligible pickers qualify, and only while picking is open', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const store = tokenFor('store@retail.local');
    const picker = tokenFor('picker@retail.local');
    const pickerId = findUserByEmail('picker@retail.local')!.id;
    const id = queuedTransfer();

    assert.equal((await call('PATCH', `/transfers/${id}/picker`, store, { pickerId })).status, 403);
    assert.equal((await call('PATCH', `/transfers/${id}/picker`, picker, { pickerId })).status, 403);
    assert.equal((await call('GET', `/transfers/${id}/eligible-pickers`, store)).status, 403);

    // A store user is not a picker, and a picker of another company is answered like a missing user.
    assert.equal((await call('PATCH', `/transfers/${id}/picker`, admin, { pickerId: findUserByEmail('store@retail.local')!.id })).status, 400);
    const foreign = createEnhancedUser({
      companyId: `company-${unique()}`, email: `foreign-${unique()}@other.local`, name: 'Foreign Picker', role: 'WAREHOUSE_PICKER',
      branchIds: [], locationIds: ['wh-1'], status: 'active',
    });
    const foreignAttempt = await call('PATCH', `/transfers/${id}/picker`, admin, { pickerId: foreign.id });
    const missingAttempt = await call('PATCH', `/transfers/${id}/picker`, admin, { pickerId: 'user-does-not-exist' });
    assert.equal(foreignAttempt.status, 400);
    assert.deepEqual(foreignAttempt.body, missingAttempt.body);
    assert.ok(!(await call('GET', `/transfers/${id}/eligible-pickers`, admin)).body.pickers.some((entry: any) => entry.id === foreign.id));
    assert.equal((await call('PATCH', `/transfers/${id}/picker`, admin, { pickerId: 42 })).status, 400);

    // Once the pick is confirmed there is nothing left to assign.
    const confirmed = queuedTransfer('CONFIRMED');
    assert.equal((await call('PATCH', `/transfers/${confirmed}/picker`, admin, { pickerId })).status, 409);
  });
});

test('dispatch notifies the destination store user and branch manager, not the source or other stores', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const id = queuedTransfer('CONFIRMED');
    const before = memoryNotifications.length;

    const sent = await call('PATCH', `/transfers/${id}/status`, admin, { status: 'DISPATCHED' });
    assert.equal(sent.status, 200);
    const notices = memoryNotifications.slice(before);
    assert.deepEqual(notices.map((notice) => notice.userId).sort(), ['user-manager-1', 'user-store-1']);
    assert.ok(notices.every((notice) => notice.type === 'transfer.dispatched' && notice.body.includes(id)));

    // Moving on to IN_TRANSIT does not notify again.
    const mark = memoryNotifications.length;
    assert.equal((await call('PATCH', `/transfers/${id}/status`, admin, { status: 'IN_TRANSIT' })).status, 200);
    assert.equal(memoryNotifications.length, mark);
    assert.equal(findTransferForCompany(id, findUserByEmail('admin@retail.local')!.companyId)?.status, 'IN_TRANSIT');
  });
});

test('the packed dispatch route notifies the destination store with the carrier details', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const picker = tokenFor('picker@retail.local');
    const id = queuedTransfer('CONFIRMED');
    assert.equal((await call('POST', `/transfers/${id}/cartons`, picker, { lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 4 }] })).status, 201);
    assert.equal((await call('POST', `/transfers/${id}/pack/complete`, picker)).status, 200);

    const before = memoryNotifications.length;
    const sent = await call('POST', `/transfers/${id}/dispatch`, admin, { carrier: 'BlueDart', vehicleNo: 'RJ14AB1234' });
    assert.equal(sent.status, 200);
    const notices = memoryNotifications.slice(before);
    assert.deepEqual(notices.map((notice) => notice.userId).sort(), ['user-manager-1', 'user-store-1']);
    assert.match(notices[0].body, /BlueDart/);
    assert.match(notices[0].body, /RJ14AB1234/);

    // A retried dispatch is a duplicate and does not notify twice.
    const mark = memoryNotifications.length;
    assert.equal((await call('POST', `/transfers/${id}/dispatch`, admin, { carrier: 'BlueDart' })).body.duplicate, true);
    assert.equal(memoryNotifications.length, mark);
  });
});

test('receiver selection: active store users and branch managers of the destination in the same company', () => {
  const base = { status: 'active' as const, companyId: 'c1' };
  const users = [
    { ...base, id: 'store-dest', role: 'STORE_USER' as const, locationIds: ['loc-1'] },
    { ...base, id: 'manager-dest', role: 'BRANCH_MANAGER' as const, locationIds: ['loc-1', 'loc-2'] },
    { ...base, id: 'store-other', role: 'STORE_USER' as const, locationIds: ['loc-2'] },
    { ...base, id: 'picker-dest', role: 'WAREHOUSE_PICKER' as const, locationIds: ['loc-1'] },
    { ...base, id: 'store-inactive', role: 'STORE_USER' as const, locationIds: ['loc-1'], status: 'inactive' as const },
    { ...base, id: 'store-foreign', role: 'STORE_USER' as const, locationIds: ['loc-1'], companyId: 'c2' },
  ];
  assert.deepEqual(transferReceiverIds(users, 'c1', 'loc-1'), ['store-dest', 'manager-dest']);
  assert.equal(isEligiblePicker(users[3], 'c1', 'loc-1'), true);
  assert.equal(isEligiblePicker(users[3], 'c2', 'loc-1'), false);
  assert.equal(isEligiblePicker(users[0], 'c1', 'loc-1'), false);
  assert.equal(isEligiblePicker(undefined, 'c1', 'loc-1'), false);
});
