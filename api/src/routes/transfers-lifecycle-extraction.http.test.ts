// PATCH/DELETE /transfers/:id and PATCH /transfers/:id/status moved from core.ts to transfers.ts. The harness
// mounts ONLY transfersRouter (it applies its own auth), so these pass only if the routes really live there.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { createTransferRecord, findTransferForCompany } from '../lib/repository.js';
import { extractToken } from './enterprise-auth.js';
import transfersRouter from './transfers.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;
const tokenFor = (email: string) => { const user = findUserByEmail(email)!; return generateJWT(user.id, user.companyId); };

async function withServer(run: (call: Api) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', transfersRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const call: Api = async (method, path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const seed = (status: 'REQUESTED' | 'CONFIRMED') => {
  const id = `ext-${Math.random().toString(36).slice(2, 8)}`;
  createTransferRecord({
    id, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status,
    lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }], createdAt: new Date().toISOString(), companyId: 'default-company',
  });
  return id;
};

test('the owner deletes an editable transfer; a non-editable one is refused', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const editable = seed('REQUESTED');
    const deleted = await call('DELETE', `/transfers/${editable}`, admin);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(findTransferForCompany(editable, 'default-company'), undefined);
    assert.equal((await call('DELETE', `/transfers/${editable}`, admin)).status, 404);

    const confirmed = seed('CONFIRMED');
    assert.equal((await call('DELETE', `/transfers/${confirmed}`, admin)).status, 403);
    assert.ok(findTransferForCompany(confirmed, 'default-company'));
  });
});

test("another company's admin gets 404 on edit, delete and status, and the transfer is untouched", async () => {
  await withServer(async (call) => {
    const owner = tokenFor('admin@retail.local');
    const other = tokenFor('admin@jaipur.local');
    const id = seed('REQUESTED');
    assert.equal((await call('PATCH', `/transfers/${id}`, other, { lines: [] })).status, 404);
    assert.equal((await call('DELETE', `/transfers/${id}`, other)).status, 404);
    assert.equal((await call('PATCH', `/transfers/${id}/status`, other, { status: 'REJECTED' })).status, 404);
    assert.equal(findTransferForCompany(id, 'default-company')?.status, 'REQUESTED');
    // the same status call succeeds for the owning company, so the 404 above was the tenant check
    const ok = await call('PATCH', `/transfers/${id}/status`, owner, { status: 'REJECTED' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(findTransferForCompany(id, 'default-company')?.status, 'REJECTED');
  });
});

test('an unknown status value is rejected with 400', async () => {
  await withServer(async (call) => {
    const id = seed('REQUESTED');
    assert.equal((await call('PATCH', `/transfers/${id}/status`, tokenFor('admin@retail.local'), { status: 'NOT_A_STATUS' })).status, 400);
  });
});
