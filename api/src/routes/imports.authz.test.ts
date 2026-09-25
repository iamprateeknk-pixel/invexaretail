// Staged imports post stock in bulk. Only admins may stage/commit/reverse;
// auditors may read status and failures; every other role is refused BEFORE any
// database work happens (so this runs without Postgres).
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import importsRouter from './imports.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (call: (method: string, path: string, email: string, body?: unknown) => Promise<number>) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', importsRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  const call = async (method: string, path: string, email: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokenFor(email)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.status;
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const mutations: Array<[string, string, unknown?]> = [
  ['POST', '/imports/staged/batches', { type: 'PURCHASE', fileName: 'x.csv', rows: [{ itemCode: 'A', quantity: '1' }] }],
  ['POST', '/imports/staged/batches/b1/validate'],
  ['POST', '/imports/staged/batches/b1/commit'],
  ['POST', '/imports/staged/batches/b1/reverse', { reason: 'x' }],
];

test('store users, pickers and managers cannot stage, validate, commit or reverse imports', async () => {
  await withServer(async (call) => {
    for (const email of ['store@retail.local', 'picker@retail.local', 'manager@retail.local', 'auditor@retail.local']) {
      for (const [method, path, body] of mutations) {
        assert.equal(await call(method, path, email, body), 403, `${email} ${method} ${path}`);
      }
    }
  });
});

test('reading a batch or its failures is refused for a store user but not by the role gate for an auditor', async () => {
  await withServer(async (call) => {
    assert.equal(await call('GET', '/imports/staged/batches/b1', 'store@retail.local'), 403);
    assert.equal(await call('GET', '/imports/staged/batches/b1/failures', 'picker@retail.local'), 403);
    // Past the role gate an auditor reaches the handler (which needs a database), so it is anything but 403.
    assert.notEqual(await call('GET', '/imports/staged/batches/b1', 'auditor@retail.local'), 403);
  });
});

test('an admin passes the role gate (validation of the body still applies)', async () => {
  await withServer(async (call) => {
    assert.equal(await call('POST', '/imports/staged/batches', 'admin@retail.local', { type: 'NOPE', fileName: 'x.csv', rows: [{}] }), 400);
  });
});
