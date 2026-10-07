// core.ts tenant sweep on real Postgres: item photos are reachable only through an item of the caller's
// own company, and user permissions can only be read or changed for the caller's own company's users.
// A foreign id is 404 (never 403) and nothing changes; the identical call succeeds for the owner.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import coreRouter from './core.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', coreRouter);
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
const itemIds: string[] = [];
test.after(async () => {
  if (!companyIds.length) return;
  await prisma.itemPhoto.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } });
});

async function makeUser(label: string, role: 'ADMIN' | 'STORE_USER', companyId?: string) {
  const company = companyId ?? `core-co-${label}-${randomUUID()}`;
  if (!companyId) {
    await prisma.companyProfile.create({ data: { id: company, name: company } });
    companyIds.push(company);
  }
  const userId = `core-user-${label}-${randomUUID()}`;
  const email = `${userId}@test.invexa.local`;
  await prisma.user.create({ data: { id: userId, name: label, email, passwordHash: 'x', role, assignedLocations: '[]', companyId: company } });
  createEnhancedUser({ id: userId, companyId: company, email, name: label, role, branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  userIds.push(userId);
  return { companyId: company, userId, token: generateJWT(userId, company) };
}

integration('item photos: read, list and delete only work through an item of the caller\'s own company', async () => {
  const a = await makeUser('ph-a', 'ADMIN');
  const b = await makeUser('ph-b', 'ADMIN');
  const itemId = `core-photo-item-${randomUUID()}`;
  itemIds.push(itemId);
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Photo item', unit: 'ea', companyId: a.companyId } });
  const photo = await prisma.itemPhoto.create({ data: { itemId, fileName: 'p.png', mimeType: 'image/png', byteSize: 3, uploadedBy: a.userId, contents: Buffer.from([1, 2, 3]) } });

  await withServer(async (call) => {
    for (const [method, path] of [['GET', `/items/${itemId}/photos`], ['GET', `/items/${itemId}/photos/${photo.id}`], ['DELETE', `/items/${itemId}/photos/${photo.id}`]] as const) {
      const foreign = await call(method, path, b.token);
      assert.equal(foreign.status, 404, `${method} ${path} must be 404 for another company`);
    }
    assert.ok(await prisma.itemPhoto.findUnique({ where: { id: photo.id } }), 'the photo survives a foreign delete');

    const ownList = await call('GET', `/items/${itemId}/photos`, a.token);
    assert.equal(ownList.status, 200, 'the identical list succeeds for the owner');
    assert.equal(ownList.body.photos.length, 1);
    const ownDelete = await call('DELETE', `/items/${itemId}/photos/${photo.id}`, a.token);
    assert.equal(ownDelete.status, 200);
  });
});

integration('user permissions: another company\'s users can be neither read nor restricted', async () => {
  const a = await makeUser('pm-a', 'ADMIN');
  const b = await makeUser('pm-b', 'ADMIN');
  const targetA = await makeUser('pm-target', 'STORE_USER', a.companyId);

  await withServer(async (call) => {
    const foreignRead = await call('GET', `/users/${targetA.userId}/permissions`, b.token);
    assert.equal(foreignRead.status, 404, 'a foreign user looks exactly like a missing one');

    const foreignWrite = await call('PUT', `/users/${targetA.userId}/permissions`, b.token, { permissions: [{ module: 'INVENTORY', action: 'VIEW' }] });
    assert.equal(foreignWrite.status, 404);
    assert.equal(await prisma.userPermission.count({ where: { userId: targetA.userId } }), 0, 'nothing was written for the foreign user');

    const ownRead = await call('GET', `/users/${targetA.userId}/permissions`, a.token);
    assert.equal(ownRead.status, 200, 'the identical read succeeds for the owner');
  });
});
