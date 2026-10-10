import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { locations } from '../lib/repository.js';
import { extractToken } from './enterprise-auth.js';
import locationOrderRouter from './location-order.js';
import coreRouter from './core.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

// An admin moves branches and warehouses up or down in the location switcher;
// GET /locations (which the web and mobile switchers render as-is) follows it.

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const saved = locations.map((location) => ({ ...location }));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', locationOrderRouter);
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
    locations.splice(0, locations.length, ...saved);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const idsOf = (body: { locations: Array<{ id: string }> }) => body.locations.map((location) => location.id);

test('an admin reorders locations and GET /locations returns the new order', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const before = idsOf((await call('GET', '/locations', admin)).body);
    assert.ok(before.length >= 3, JSON.stringify(before));
    const reversed = [...before].reverse();

    const saved = await call('PUT', '/locations/order', admin, { locationIds: reversed });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(idsOf(saved.body), reversed);

    const after = await call('GET', '/locations', admin);
    assert.deepEqual(idsOf(after.body), reversed);
    assert.equal(after.body.activeLocationId, reversed[0], 'the first location in the order is the default one');
  });
});

test('the order must name every company location exactly once', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const ids = idsOf((await call('GET', '/locations', admin)).body);
    assert.equal((await call('PUT', '/locations/order', admin, { locationIds: ids.slice(1) })).status, 400);
    assert.equal((await call('PUT', '/locations/order', admin, { locationIds: [...ids, ids[0]] })).status, 400);
    assert.equal((await call('PUT', '/locations/order', admin, { locationIds: [...ids.slice(1), 'loc-nowhere'] })).status, 400);
    assert.equal((await call('PUT', '/locations/order', admin, { locationIds: 'loc-1' })).status, 400);
  });
});

test('only admins can change the location order', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const ids = idsOf((await call('GET', '/locations', admin)).body);
    for (const email of ['manager@retail.local', 'store@retail.local', 'auditor@retail.local']) {
      const refused = await call('PUT', '/locations/order', tokenFor(email), { locationIds: [...ids].reverse() });
      assert.equal(refused.status, 403, email);
    }
    assert.deepEqual(idsOf((await call('GET', '/locations', admin)).body), ids);
  });
});
