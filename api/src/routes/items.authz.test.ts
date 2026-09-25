// Manual adjustments/reversals post stock; only admins may. The role gate runs
// before any database work, so this needs no Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import itemsRouter from './items.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

async function withServer(run: (call: (path: string, email: string, body: unknown) => Promise<number>) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', itemsRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  const call = async (path: string, email: string, body: unknown) => {
    const user = findUserByEmail(email)!;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${generateJWT(user.id, user.companyId)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.status;
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('store users, pickers, managers and auditors cannot adjust or reverse stock', async () => {
  await withServer(async (call) => {
    for (const email of ['store@retail.local', 'picker@retail.local', 'manager@retail.local', 'auditor@retail.local']) {
      assert.equal(await call('/items/item-1001/adjust', email, { locationId: 'l', lotId: 'l', qtyDelta: 5, reason: 'x', idempotencyKey: 'k' }), 403, `${email} adjust`);
      assert.equal(await call('/items/item-1001/movements/m1/reverse', email, { reason: 'x' }), 403, `${email} reverse`);
    }
  });
});

test('an admin passes the role gate and reaches request validation', async () => {
  await withServer(async (call) => {
    assert.equal(await call('/items/item-1001/adjust', 'admin@retail.local', {}), 400);
  });
});
