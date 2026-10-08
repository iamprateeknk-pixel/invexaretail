// GET /putaway-tasks: a putaway task has no company column; it belongs to the company that owns its location. For an
// Admin with no locationId the scope was `{}` and the query had no company filter, so every company's pending tasks
// (with item, lot and location names) came back. Only the caller's own company's tasks may be listed.
// DB-only - skipped unless TEST_DATABASE_URL is set. Reuses the harness of the other operations-extension suites.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import operationsExtensionRouter from './operations-extension.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function withServer(run: (list: (token: string) => Promise<{ status: number; body: any }>) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', operationsExtensionRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const list = async (token: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/putaway-tasks`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try {
    await run(list);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function makeCompany() {
  const companyId = `putaway-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `putaway-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Putaway Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Putaway Admin', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const locationId = `putaway-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Putaway Loc', type: 'warehouse', companyId } });
  const itemId = `putaway-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Putaway Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { id: `putaway-lot-${randomUUID()}`, lotNo: 'PUT-LOT', itemId } });
  const task = await prisma.putawayTask.create({ data: { itemId, lotId: lot.id, locationId, quantity: 5 } as never });
  return { companyId, locationId, taskId: task.id, token: generateJWT(userId, companyId) };
}

integration("GET /putaway-tasks without a location returns only the caller's own company's tasks", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  await withServer(async (list) => {
    const forA = await list(a.token);
    assert.equal(forA.status, 200);
    const idsForA = forA.body.tasks.map((task: { id: string }) => task.id);
    assert.ok(idsForA.includes(a.taskId), 'the owning company sees its own task');
    assert.ok(!idsForA.includes(b.taskId), "another company's task is not listed");
    const idsForB = (await list(b.token)).body.tasks.map((task: { id: string }) => task.id);
    assert.ok(idsForB.includes(b.taskId) && !idsForB.includes(a.taskId));
  });
});
