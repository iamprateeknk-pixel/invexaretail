// Real-Postgres coverage for the granular per-user permission control (admin -> function-level
// access for any user) and the two gaps closed alongside it:
//  - enforcePermissionOverrides was never applied by campaigns.ts / item-master.ts /
//    import-control-center.ts / transfer-logistics.ts / command-center.ts, so an admin's explicit
//    DENY on a user silently had no effect on routes served by those five routers.
//  - "give this picker the same access as that store user" is now a single action:
//    POST /users/:userId/permissions/copy-from/:sourceUserId.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import coreRouter from './core.js';
import transferLogisticsRouter from './transfer-logistics.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', transferLogisticsRouter);
  app.use('/api/v1', coreRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  const call: Api = async (method, path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function makeUser(companyId: string, role: string, tag: string) {
  const userId = `perm-user-${tag}-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: tag, email: `${userId}@test.invexa.local`, passwordHash: 'x', role: role as never, assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: tag, role: role as never, branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  return { userId, token: generateJWT(userId, companyId) };
}

async function makeCompany() {
  const companyId = `perm-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const admin = await makeUser(companyId, 'ADMIN', 'admin');
  return { companyId, ...admin };
}

integration('a per-user DENY override actually blocks a route in one of the five routers that never enforced it (audit: control function)', async () => {
  const a = await makeCompany();
  const picker = await makeUser(a.companyId, 'WAREHOUSE_PICKER', 'picker');
  await withServer(async (call) => {
    // Before any override, a warehouse picker is normally allowed to open a (nonexistent) pack view -
    // the request reaches the route's own 404, not a permission rejection.
    const before = await call('GET', '/transfers/does-not-exist/pack', picker.token);
    assert.equal(before.status, 404);

    const put = await call('PUT', `/users/${picker.userId}/permissions`, a.token, {
      permissions: [{ module: 'TRANSFER', action: 'VIEW', denied: true, reason: 'test' }],
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));

    const denied = await call('GET', '/transfers/does-not-exist/pack', picker.token);
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.code, 'PERMISSION_DENIED');

    // Clearing the override (an empty permission set) restores normal role-based access.
    const clear = await call('PUT', `/users/${picker.userId}/permissions`, a.token, { permissions: [] });
    assert.equal(clear.status, 200);
    const restored = await call('GET', '/transfers/does-not-exist/pack', picker.token);
    assert.equal(restored.status, 404, 'the override is gone; the request reaches the route again');
  });
});

integration('copying permissions gives one user the exact same function-level access as another, and is tenant scoped', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const storeUser = await makeUser(a.companyId, 'STORE_USER', 'store');
  const picker = await makeUser(a.companyId, 'WAREHOUSE_PICKER', 'picker');
  const outsider = await makeUser(b.companyId, 'STORE_USER', 'outsider');
  await withServer(async (call) => {
    const set = await call('PUT', `/users/${storeUser.userId}/permissions`, a.token, {
      permissions: [
        { module: 'TRANSFER', action: 'VIEW', denied: true },
        { module: 'COUNT', action: 'CREATE', allowed: true },
      ],
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));

    // Cross-tenant: company B's admin cannot reach company A's users at all.
    assert.equal((await call('POST', `/users/${picker.userId}/permissions/copy-from/${storeUser.userId}`, b.token, {})).status, 404);

    const copy = await call('POST', `/users/${picker.userId}/permissions/copy-from/${storeUser.userId}`, a.token, {});
    assert.equal(copy.status, 200, JSON.stringify(copy.body));
    assert.equal(copy.body.permissionCount, 2);

    const pickerPermissions = await call('GET', `/users/${picker.userId}/permissions`, a.token);
    const byKey = new Map(pickerPermissions.body.permissions.map((row: { permission: { module: string; action: string }; allowed: boolean; denied: boolean }) => [`${row.permission.module}:${row.permission.action}`, row]));
    assert.equal((byKey.get('TRANSFER:VIEW') as { denied: boolean }).denied, true);
    assert.equal((byKey.get('COUNT:CREATE') as { allowed: boolean }).allowed, true);

    // The outsider (a different company entirely) cannot be used as a copy source across tenants either.
    assert.equal((await call('POST', `/users/${picker.userId}/permissions/copy-from/${outsider.userId}`, a.token, {})).status, 404);
  });
});
