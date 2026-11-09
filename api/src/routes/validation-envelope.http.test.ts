// [ULTRA] P3 (#186): one test per touched route proving the 400 envelope
// on bad input — { error, code, traceId } with no `message` field — for
// every converted route memory mode can reach. DB-backed routes (returns,
// most of procurement, pack/ship) live in validation-envelope.postgres.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { counts, createCountRecord } from '../lib/repository.js';
import { applyLateMovements } from '../lib/late-movement-service.js';
import transfersRouter from './transfers.js';
import coreRouter from './core.js';
import operationsExtensionRouter from './operations-extension.js';
import catalogProcurementRouter from './catalog-procurement.js';

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
  app.use('/api/v1', transfersRouter);
  app.use('/api/v1', coreRouter);
  app.use('/api/v1', operationsExtensionRouter);
  app.use('/api/v1', catalogProcurementRouter);
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
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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

/** The single ADR-006 envelope: error + code + traceId, never `message`. */
function assertEnvelope(response: { status: number; body: any }, status: number, code: string): void {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(typeof response.body.error, 'string', JSON.stringify(response.body));
  assert.ok(response.body.error.length > 0, JSON.stringify(response.body));
  assert.equal(response.body.code, code, JSON.stringify(response.body));
  assert.equal(typeof response.body.traceId, 'string', JSON.stringify(response.body));
  assert.ok(response.body.traceId.length > 0, JSON.stringify(response.body));
  assert.equal(response.body.message, undefined, JSON.stringify(response.body));
}

async function makeTransfer(call: Api, admin: string): Promise<string> {
  const created = await call('POST', '/transfers', admin, {
    sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
    lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.transfer.id as string;
}

test('transfers: bad create/edit/status/picker bodies return the 400 envelope', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    assertEnvelope(
      await call('POST', '/transfers', admin, { sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', lines: [] }),
      400, 'VALIDATION_FAILED',
    );
    const id = await makeTransfer(call, admin);
    assertEnvelope(
      await call('PATCH', `/transfers/${id}`, admin, {
        sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
        lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 0 }],
      }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PATCH', `/transfers/${id}/status`, admin, { status: 'BOGUS' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PATCH', `/transfers/${id}/picker`, admin, { pickerId: 123 }),
      400, 'VALIDATION_FAILED',
    );
  });
});

test('transfers: picker routes reject bad bodies with the 400 envelope', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const picker = tokenFor('picker@retail.local');
    const id = await makeTransfer(call, admin);
    assertEnvelope(
      await call('POST', `/picker/transfers/${id}/allocation-preview`, admin, {}),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('POST', `/picker/transfers/${id}/pick-slips`, picker, {}),
      400, 'VALIDATION_FAILED',
    );
  });
});

test('transfers: receive with no requestId, confirm in the wrong state, and missing ids use the envelope', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const id = await makeTransfer(call, admin);
    const receive = await call('POST', `/transfers/${id}/receive`, admin, { requestId: '' });
    assertEnvelope(receive, 400, 'VALIDATION_FAILED');
    assert.match(receive.body.error, /requestId/);
    assertEnvelope(
      await call('POST', `/transfers/${id}/confirm`, admin, {}),
      400, 'INVALID_TRANSITION',
    );
    assertEnvelope(
      await call('DELETE', '/transfers/nope', admin),
      404, 'NOT_FOUND',
    );
    assertEnvelope(
      await call('GET', '/transfers/nope/export.xls', admin),
      404, 'NOT_FOUND',
    );
  });
});

test('counts: bad submit/weight/review bodies return the 400 envelope', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    assertEnvelope(
      await call('POST', '/stock-counts', admin, { itemId: 'item-1001', locationId: 'loc-1', physicalQuantity: '5' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('POST', '/stock-counts/weight', admin, { itemId: 'item-1001', locationId: 'loc-1', totalQuantity: -1 }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PATCH', '/stock-counts/nope/review', admin, { status: 'MAYBE', reviewReason: 'looks good' }),
      400, 'VALIDATION_FAILED',
    );
  });
});

test('counts: a short reconciliation note returns the 400 envelope on a flagged count', async () => {
  counts.splice(0, counts.length);
  createCountRecord({
    id: 'count-pending', itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', physicalQuantity: 24, bookQty: 28, mode: 'manual',
    submittedBy: 'user-store-1', role: 'STORE_USER', createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  await applyLateMovements([{
    id: 'mv-k', dedupeKey: 'k', itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', movementType: 'SALE_OUT', qtyDelta: -4,
    transactionAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), sourceType: 'SALES', sourceReference: 'INV-9', createdById: 'user-admin-1',
  }]);
  assert.equal(counts.find((row) => row.id === 'count-pending')!.reconciliationRequired, true);
  await withServer(async (call) => {
    const manager = tokenFor('manager@retail.local');
    assertEnvelope(
      await call('POST', '/stock-counts/count-pending/reconciliation/ack', manager, { note: 'no' }),
      400, 'VALIDATION_FAILED',
    );
  });
});

test('counts: bad assignment create/update/bulk-delete and cycle-assign bodies return the 400 envelope', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    assertEnvelope(
      await call('POST', '/count-assignments', admin, { locationId: 'loc-1', storeUserId: 'user-store-1', itemIds: [] }),
      400, 'VALIDATION_FAILED',
    );
    const created = await call('POST', '/count-assignments', admin, { locationId: 'loc-1', storeUserId: 'user-store-1', itemIds: ['item-1001'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assertEnvelope(
      await call('PATCH', `/count-assignments/${created.body.assignments[0].id}`, admin, { status: 'DONE' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('DELETE', '/count-assignments/bulk', admin, { assignmentIds: [] }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('POST', '/cycle-counts/loc-1/assign', admin, { classes: ['A'] }),
      400, 'VALIDATION_FAILED',
    );
  });
});

test('orders: a create with no lines returns the 400 envelope', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    assertEnvelope(
      await call('POST', '/orders', admin, { channel: 'web', lines: [] }),
      400, 'VALIDATION_FAILED',
    );
  });
});

test('procurement: a reorder rule with a non-positive orderMultiple returns the 400 envelope', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    assertEnvelope(
      await call('PUT', '/reorder-rules/item-1001', admin, { locationId: 'loc-1', minQty: 1, targetQty: 5, orderMultiple: 0 }),
      400, 'VALIDATION_FAILED',
    );
  });
});
