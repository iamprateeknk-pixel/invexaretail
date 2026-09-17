import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail, createEnhancedUser } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
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
  if (!findUserByEmail('admin@jaipur.local')) {
    createEnhancedUser({
      id: 'user-jaipur-admin',
      companyId: 'company-jaipur',
      email: 'admin@jaipur.local',
      name: 'Jaipur Admin',
      role: 'ADMIN',
      branchIds: [],
      locationIds: ['loc-jaipur-1'],
      passwordHash: hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'),
      status: 'active',
    });
  }
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, requireAuth, enforceOperationalCompanyScope, coreRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run(url);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function json(url: string, path: string, token: string) {
  const response = await fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

test('HTTP: Jaipur admin cannot read grocery locations, items or stock', async () => {
  await withServer(async (url) => {
    const grocery = tokenFor('admin@retail.local');
    const jaipur = tokenFor('admin@jaipur.local');

    const groceryLocations = await json(url, '/api/v1/locations', grocery);
    assert.equal(groceryLocations.status, 200);
    assert.equal(groceryLocations.body.locations.some((location: { id: string }) => location.id === 'loc-1'), true);
    assert.equal(groceryLocations.body.locations.some((location: { id: string }) => location.id === 'loc-jaipur-1'), false);

    const jaipurLocations = await json(url, '/api/v1/locations', jaipur);
    assert.equal(jaipurLocations.status, 200);
    assert.equal(jaipurLocations.body.locations.some((location: { id: string }) => location.id === 'loc-1'), false);
    assert.equal(jaipurLocations.body.locations.some((location: { id: string }) => location.id === 'loc-jaipur-1'), true);

    const groceryItems = await json(url, '/api/v1/items', grocery);
    assert.equal(groceryItems.body.items.some((item: { id: string }) => item.id === 'item-1001'), true);
    assert.equal(groceryItems.body.items.some((item: { id: string }) => item.id === 'item-jaipur-1'), false);

    const jaipurItems = await json(url, '/api/v1/items', jaipur);
    assert.equal(jaipurItems.status, 200);
    assert.equal(jaipurItems.body.items.some((item: { id: string }) => item.id === 'item-1001'), false);
    assert.equal(jaipurItems.body.items.some((item: { id: string }) => item.id === 'item-jaipur-1'), true);

    const groceryStock = await json(url, '/api/v1/stock/loc-1', grocery);
    assert.equal(groceryStock.status, 200);

    const jaipurOwnStock = await json(url, '/api/v1/stock/loc-jaipur-1', jaipur);
    assert.equal(jaipurOwnStock.status, 200);
    assert.equal(jaipurOwnStock.body.items.some((row: { itemId: string }) => row.itemId === 'item-jaipur-1'), true);

    const jaipurStock = await json(url, '/api/v1/stock/loc-1', jaipur);
    assert.equal(jaipurStock.status, 403);
    assert.equal(jaipurStock.body.code, 'COMPANY_SCOPE_MISMATCH');
  });
});
