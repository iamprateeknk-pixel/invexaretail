import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { adjustStockLedger } from '../lib/repository.js';
import { hidesZeroStockForRole, parseItemOperationalMeta } from '../lib/inventory.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, requireAuth, enforceOperationalCompanyScope, coreRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function getStock(url: string, locationId: string, token: string) {
  const response = await fetch(`${url}/api/v1/stock/${locationId}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() as { items: Array<{ itemId: string; lotId?: string }> } };
}

test('hidesZeroStockForRole only applies to operational roles', () => {
  assert.equal(hidesZeroStockForRole('STORE_USER'), true);
  assert.equal(hidesZeroStockForRole('WAREHOUSE_PICKER'), true);
  for (const role of ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'] as const) {
    assert.equal(hidesZeroStockForRole(role), false);
  }
});

test('HTTP: store user and picker never see a zero-stock row, admin still does', async () => {
  // Drain item-1006 at loc-1 to exactly zero, keeping the row in the ledger.
  adjustStockLedger('item-1006', 'lot-1006', 'loc-1', -12);
  try {
    await withServer(async (url) => {
      const store = await getStock(url, 'loc-1', tokenFor('store@retail.local'));
      assert.equal(store.status, 200);
      assert.equal(store.body.items.some((row) => row.itemId === 'item-1006'), false);
      assert.equal(store.body.items.some((row) => row.itemId === 'item-1001'), true);

      const admin = await getStock(url, 'loc-1', tokenFor('admin@retail.local'));
      assert.equal(admin.status, 200);
      assert.equal(admin.body.items.some((row) => row.itemId === 'item-1006'), true);
    });
  } finally {
    adjustStockLedger('item-1006', 'lot-1006', 'loc-1', 12);
  }
});

test('parseItemOperationalMeta returns only provided keys and rejects bad enums', () => {
  assert.deepEqual(parseItemOperationalMeta({}), {});
  assert.deepEqual(
    parseItemOperationalMeta({ countMethod: 'ITEM_WEIGHT', allocationStrategy: 'FIFO', decimalQuantity: true }),
    { countMethod: 'ITEM_WEIGHT', allocationStrategy: 'FIFO', decimalQuantity: true },
  );
  assert.throws(() => parseItemOperationalMeta({ countMethod: 'GUESS' }), /countMethod/);
  assert.throws(() => parseItemOperationalMeta({ pickMethod: 'RANDOM' }), /pickMethod/);
  assert.throws(() => parseItemOperationalMeta({ allocationStrategy: 'LIFO' }), /allocationStrategy/);
});
