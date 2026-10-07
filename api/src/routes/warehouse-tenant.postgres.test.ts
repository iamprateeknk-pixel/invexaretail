// Warehouse tenant sweep on real Postgres: pick waves, bins and putaway tasks resolve only inside the
// caller's own company. A foreign id is 404 (never 403) and nothing changes; the identical call
// succeeds for the owner. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { registerLocationCompany } from '../lib/saas/tenant-scope.js';
import coreRouter from './core.js';
import operationsExtensionRouter from './operations-extension.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', coreRouter);
  app.use('/api/v1', operationsExtensionRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('failed to bind test server'); }
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call: Api = async (method, path, token, body) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const userIds: string[] = [];
const companyIds: string[] = [];
test.after(async () => {
  if (!companyIds.length) return;
  await prisma.putawayTask.deleteMany({ where: { location: { companyId: { in: companyIds } } } });
  await prisma.pickWave.deleteMany({ where: { location: { companyId: { in: companyIds } } } });
  await prisma.bin.deleteMany({ where: { location: { companyId: { in: companyIds } } } });
});

async function makeAdmin(label: string) {
  const companyId = `wh-co-${label}-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  companyIds.push(companyId);
  const userId = `wh-admin-${label}-${randomUUID()}`;
  const email = `${userId}@test.invexa.local`;
  await prisma.user.create({ data: { id: userId, name: label, email, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email, name: label, role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  userIds.push(userId);
  const locationId = `wh-loc-${label}-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'WH', type: 'warehouse', companyId } });
  registerLocationCompany(locationId, companyId); // the in-memory ownership map the strict location check reads
  const itemId = `wh-item-${label}-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'WH item', unit: 'ea', companyId } });
  return { companyId, userId, locationId, itemId, token: generateJWT(userId, companyId) };
}

integration('pick waves, bins and putaway tasks: a foreign id is 404 and nothing changes', async () => {
  const a = await makeAdmin('a');
  const b = await makeAdmin('b');
  const wave = await prisma.pickWave.create({ data: { locationId: a.locationId, transferIds: [], createdById: a.userId } });
  const bin = await prisma.bin.create({ data: { locationId: a.locationId, code: `BIN-${randomUUID()}` } });
  const task = await prisma.putawayTask.create({ data: { itemId: a.itemId, locationId: a.locationId, quantity: 5 } });

  await withServer(async (call) => {
    const waveGet = await call('GET', `/pick-waves/${wave.id}`, b.token);
    assert.equal(waveGet.status, 404, 'GET wave: 404 not 403');
    const wavePatch = await call('PATCH', `/pick-waves/${wave.id}`, b.token, { status: 'CANCELLED' });
    assert.equal(wavePatch.status, 404, 'PATCH wave: 404');
    assert.equal((await prisma.pickWave.findUniqueOrThrow({ where: { id: wave.id } })).status, 'OPEN', 'the wave is untouched');

    const binPatch = await call('PATCH', `/bins/${bin.id}`, b.token, { zone: 'HIJACKED' });
    assert.equal(binPatch.status, 404, 'PATCH bin: 404');
    assert.equal((await prisma.bin.findUniqueOrThrow({ where: { id: bin.id } })).zone, null, 'the bin is untouched');

    const confirm = await call('POST', `/putaway-tasks/${task.id}/confirm`, b.token, { scannedBinCode: bin.code });
    assert.equal(confirm.status, 404, 'confirm putaway: 404 not 403');
    assert.equal((await prisma.putawayTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'PENDING', 'the task is untouched');

    assert.equal((await call('GET', `/pick-waves/${wave.id}`, a.token)).status, 200, 'the identical wave read succeeds for the owner');
    assert.equal((await call('PATCH', `/bins/${bin.id}`, a.token, { zone: 'A' })).status, 200, 'the identical bin patch succeeds for the owner');
  });
});
