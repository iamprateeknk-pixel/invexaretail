// Team-shared table views: the web list pages store a view as a SavedView with entityType
// `TABLE:<tableId>`. A shared view is visible to every user of the SAME company, a private one only to
// its owner, nothing crosses companies, and `?entityType=` narrows the list to one table.
// DB-only - skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import catalogProcurementRouter from './catalog-procurement.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', catalogProcurementRouter);
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

async function makeUser(companyId: string, role: 'ADMIN' | 'STORE_USER') {
  const userId = `sv-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: role, email: `${userId}@test.invexa.local`, passwordHash: 'x', role, assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: role, role, branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  return { userId, token: generateJWT(userId, companyId) };
}

async function makeCompany() {
  const companyId = `sv-company-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  return companyId;
}

integration('shared table views reach teammates in the same company only, private ones stay private, and entityType narrows the list', async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const admin = await makeUser(companyA, 'ADMIN');
  const teammate = await makeUser(companyA, 'STORE_USER');
  const outsider = await makeUser(companyB, 'ADMIN');
  const state = { q: 'rice', density: 'compact' };

  await withServer(async (call) => {
    const shared = await call('POST', '/saved-views', admin.token, { name: 'Overdue first', entityType: 'TABLE:orders', filter: state, isShared: true });
    assert.equal(shared.status, 201);
    assert.equal(shared.body.savedView.isShared, true);
    await call('POST', '/saved-views', admin.token, { name: 'Admin private', entityType: 'TABLE:orders', filter: state });
    await call('POST', '/saved-views', admin.token, { name: 'Other table', entityType: 'TABLE:exceptions', filter: state, isShared: true });

    const mate = await call('GET', '/saved-views?entityType=TABLE:orders', teammate.token);
    assert.equal(mate.status, 200);
    assert.deepEqual(mate.body.savedViews.map((view: { name: string }) => view.name), ['Overdue first'], 'a teammate sees the shared orders view only');

    const owner = await call('GET', '/saved-views?entityType=TABLE:orders', admin.token);
    assert.deepEqual(owner.body.savedViews.map((view: { name: string }) => view.name).sort(), ['Admin private', 'Overdue first']);

    const foreign = await call('GET', '/saved-views?entityType=TABLE:orders', outsider.token);
    assert.deepEqual(foreign.body.savedViews, [], 'another company never sees it');

    // A non-admin asking for a shared view gets a private one: sharing is an Admin action.
    const attempt = await call('POST', '/saved-views', teammate.token, { name: 'Sneaky', entityType: 'TABLE:orders', filter: state, isShared: true });
    assert.equal(attempt.body.savedView.isShared, false);
  });
});
