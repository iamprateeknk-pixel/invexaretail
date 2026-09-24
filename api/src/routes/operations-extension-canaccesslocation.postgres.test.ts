// Bare-id call-site migration, slice 5 (see docs/tenant-scope-coverage.md):
// centralized fix for routes/operations-extension.ts's own local
// canAccessLocation, which previously granted ADMIN/ADMIN_USER/AUDITOR
// unconditional access to ANY locationId regardless of company - the root
// cause behind most of the cross-tenant findings in slices 1-4. This test
// proves the fix directly: once a location's company ownership is known
// to the in-memory ownership map (registerLocationCompany, the same call
// core.ts's location-creation route already makes for every real
// production location), an admin of a different company is denied before
// ever reaching the query behind the route - not just left to a query-level
// companyId filter. DB-only - skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { registerLocationCompany } from '../lib/saas/tenant-scope.js';
import operationsExtensionRouter from './operations-extension.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', operationsExtensionRouter);
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

async function makeFixture() {
  const companyId = `ops-cal-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-cal-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Ops CanAccessLocation Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops CanAccessLocation Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `ops-cal-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
  // The production location-creation route (routes/core.ts) always calls
  // registerLocationCompany right after persisting the row - simulate that
  // here, rather than relying on this test creating the location via the
  // real route, so this test stays focused on canAccessLocation itself.
  registerLocationCompany(locationId, companyId);
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, token };
}

integration('GET /intelligence/:locationId: an admin of another company is denied outright once the location\'s company ownership is known, not just left to the query-level filter', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await withServer(async (call) => {
    const cross = await call('GET', `/intelligence/${a.locationId}`, b.token);
    assert.equal(cross.status, 403, 'a location registered to another company must now be denied before the route\'s own query ever runs');

    const own = await call('GET', `/intelligence/${a.locationId}`, a.token);
    assert.equal(own.status, 200, 'the owning company\'s own admin must be unaffected');
  });
});

integration('GET /intelligence/:locationId: a location with unknown ownership (not yet registered) still falls through to the original role check unchanged', async () => {
  const a = await makeFixture();
  const unregisteredLocationId = `ops-cal-unregistered-${randomUUID()}`;
  await prisma.location.create({ data: { id: unregisteredLocationId, code: unregisteredLocationId, name: 'Unregistered Loc', type: 'warehouse', companyId: a.companyId } });
  // Deliberately not calling registerLocationCompany for this one.

  await withServer(async (call) => {
    const response = await call('GET', `/intelligence/${unregisteredLocationId}`, a.token);
    assert.equal(response.status, 200, 'unknown ownership must not cause a false-deny for a legitimate admin request');
  });
});
