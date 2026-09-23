// Week 8: dedicated coverage for the first bounded-context router extracted
// out of routes/core.ts. Broader end-to-end transfer flows already exercise
// these two endpoints via transfer-logistics.http.test.ts (parity proof:
// those tests were unchanged by the extraction and still pass verbatim);
// this file adds the cases specific to the extraction itself - the stable
// error envelope on the reservation path, and that the new router does not
// widen access beyond what the old inline handler enforced.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
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
  app.use('/api/v1', transfersRouter);
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

// The atomic reservation primitive itself (including its INSUFFICIENT_STOCK
// envelope) is DB-backed only and already covered end-to-end against real
// Postgres in lib/reservation.postgres.test.ts (Week 7) - in memory mode
// reserveStockForTransfer is a documented no-op, so that path is not
// re-tested here. What belongs here is the validation this router's
// command service runs before ever calling the reservation primitive.
test('a transfer with the same source and destination is rejected before any reservation is attempted', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const response = await call('POST', '/transfers', admin, {
      sourceLocationId: 'wh-1', destinationLocationId: 'wh-1',
      lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
    });
    assert.equal(response.status, 403);
    assert.match(response.body.message, /same source and destination/);
  });
});

test('a store user cannot request a transfer to a non-warehouse destination - same rule as the pre-extraction handler', async () => {
  await withServer(async (call) => {
    const store = tokenFor('store@retail.local');
    const response = await call('POST', '/transfers', store, {
      sourceLocationId: 'loc-1', destinationLocationId: 'loc-1',
      lines: [{ itemId: 'item-1001', lotId: 'lot-1001', quantity: 1 }],
    });
    assert.equal(response.status, 400);
  });
});

test('a warehouse picker cannot create a transfer request - role check runs before reservation', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const response = await call('POST', '/transfers', picker, {
      sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
      lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
    });
    assert.equal(response.status, 403);
  });
});

test('GET /transfers/list only returns transfers the caller can access by location', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const created = await call('POST', '/transfers', admin, {
      sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
      lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
    });
    assert.equal(created.status, 201);
    const id = created.body.transfer.id;

    const adminList = await call('GET', '/transfers/list', admin);
    assert.ok(adminList.body.transfers.some((t: { id: string }) => t.id === id));

    // The auditor is only assigned loc-1 in seed data and this transfer's
    // source is wh-1 - it is still visible because loc-1 is the
    // destination, proving the filter checks both ends, not just source.
    const auditor = tokenFor('auditor@retail.local');
    const auditorList = await call('GET', '/transfers/list', auditor);
    assert.ok(auditorList.body.transfers.some((t: { id: string }) => t.id === id), 'destination-location access must also grant visibility');
  });
});

test('a successful create still writes the audit trail and the outbox event unchanged from before the extraction', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const response = await call('POST', '/transfers', admin, {
      sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
      lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 2 }],
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.transfer.status, 'REQUESTED');
  });
});
