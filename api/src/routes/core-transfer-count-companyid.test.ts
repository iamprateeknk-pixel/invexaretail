// Bare-id call-site migration slice 9 (see docs/tenant-scope-coverage.md):
// core.ts's ~18 bare-id Transfer/StockCount lookups (listTransfers().find(),
// listCounts().find()) were already protected by lib/inventory.ts's
// company-aware canAccessLocation, but relied entirely on that location
// check - the record itself carried no companyId to check directly. This
// slice converted every entry-point lookup to findTransferForCompany/
// findCountForCompany (lib/repository.ts), an independent second layer.
// Memory-mode only (no TEST_DATABASE_URL needed): these are in-memory
// records, not a Prisma model.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, createEnhancedUser } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { createTransferRecord, createCountRecord } from '../lib/repository.js';
import { extractToken } from './enterprise-auth.js';
import coreRouter from './core.js';
import transfersRouter from './transfers.js';
import { enforceOperationalCompanyScope, DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
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
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function makeAdmin(companyId: string) {
  const id = `core-companyid-user-${randomUUID()}`;
  const user = createEnhancedUser({
    id, companyId, email: `${id}@test.invexa.local`, name: 'Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: hashPassword('x'), status: 'active',
  });
  return { id: user.id, token: generateJWT(user.id, companyId) };
}

test('GET /picker/transfers/:transferId: a transfer stamped with another company\'s companyId resolves 404, not just relying on the location check', async () => {
  // wh-1/loc-1 are seeded under DEFAULT_COMPANY_ID, so the owning admin's
  // location check (lib/inventory.ts's canAccessLocation - no ADMIN
  // bypass, unlike operations-extension.ts's own version) passes for real.
  const companyA = DEFAULT_COMPANY_ID;
  const companyB = `core-companyid-b-${randomUUID()}`;
  const adminA = makeAdmin(companyA);
  const adminB = makeAdmin(companyB);
  const transferId = `core-companyid-transfer-${randomUUID()}`;
  createTransferRecord({
    id: transferId, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
    requestedBy: adminA.id, role: 'ADMIN', status: 'CONFIRMED',
    lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
    createdAt: new Date().toISOString(), companyId: companyA,
  });

  await withServer(async (call) => {
    const cross = await call('GET', `/picker/transfers/${transferId}`, adminB.token);
    assert.equal(cross.status, 404, 'a transfer stamped with another company must look identical to a missing one, even though ADMIN bypasses the location check');

    const own = await call('GET', `/picker/transfers/${transferId}`, adminA.token);
    assert.equal(own.status, 200, 'the owning company\'s own admin must be unaffected');
  });
});

test('POST /stock-counts/:countId/reconciliation/ack: a count stamped with another company\'s companyId resolves 404', async () => {
  const companyA = `core-companyid-a-${randomUUID()}`;
  const companyB = `core-companyid-b-${randomUUID()}`;
  const adminA = makeAdmin(companyA);
  const adminB = makeAdmin(companyB);
  const countId = `core-companyid-count-${randomUUID()}`;
  createCountRecord({
    id: countId, itemId: 'item-1003', lotId: 'lot-1003', locationId: 'wh-1',
    physicalQuantity: 5, bookQty: 5, mode: 'manual', submittedBy: adminA.id, role: 'ADMIN',
    createdAt: new Date().toISOString(), reconciliationRequired: true, companyId: companyA,
  });

  await withServer(async (call) => {
    const cross = await call('POST', `/stock-counts/${countId}/reconciliation/ack`, adminB.token, { note: 'cross tenant attempt' });
    assert.equal(cross.status, 404, 'a count stamped with another company must look identical to a missing one');
  });
});

test('a legacy transfer/count record with no companyId set (created before this field existed) still resolves for its owning company\'s admin - fail-safe-if-unknown', async () => {
  const adminA = makeAdmin(DEFAULT_COMPANY_ID);
  const transferId = `core-companyid-legacy-transfer-${randomUUID()}`;
  createTransferRecord({
    id: transferId, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
    requestedBy: adminA.id, role: 'ADMIN', status: 'CONFIRMED',
    lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
    createdAt: new Date().toISOString(),
    // companyId deliberately omitted, simulating a pre-existing record.
  });

  await withServer(async (call) => {
    const response = await call('GET', `/picker/transfers/${transferId}`, adminA.token);
    assert.equal(response.status, 200, 'a record with no companyId yet must not cause a false deny for a legitimate request');
  });
});
