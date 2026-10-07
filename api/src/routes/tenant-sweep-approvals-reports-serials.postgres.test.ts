// Tenant sweep on real Postgres: approval requests, saved reports (shared reports stay inside their
// company) and serial numbers are company scoped; a foreign id is 404 (never 403) and the row is
// untouched, while the identical call succeeds for the owner. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import catalogProcurementRouter from './catalog-procurement.js';
import operationsExtensionRouter from './operations-extension.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', catalogProcurementRouter);
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
  await prisma.serialMovement.deleteMany({ where: { serialNumber: { companyId: { in: companyIds } } } });
  await prisma.serialNumber.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.savedReport.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.approvalRequest.deleteMany({ where: { requestedById: { in: userIds } } });
  await prisma.approvalRule.deleteMany({ where: { createdById: { in: userIds } } });
});

async function makeAdmin(label: string) {
  const companyId = `sweep-co-${label}-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `sweep-admin-${label}-${randomUUID()}`;
  const email = `${userId}@test.invexa.local`;
  await prisma.user.create({ data: { id: userId, name: `Admin ${label}`, email, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email, name: `Admin ${label}`, role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  userIds.push(userId);
  companyIds.push(companyId);
  return { companyId, userId, token: generateJWT(userId, companyId) };
}

integration('approval requests: lists and decisions are company scoped', async () => {
  const a = await makeAdmin('ar-a');
  const b = await makeAdmin('ar-b');
  const rule = await prisma.approvalRule.create({ data: { label: 'rule', triggerType: `t-${randomUUID()}`, valueThreshold: 10, requiredApproverRole: 'ADMIN', createdById: a.userId } });
  const request = await prisma.approvalRequest.create({ data: { ruleId: rule.id, triggerType: rule.triggerType, entityType: 'X', entityId: `e-${randomUUID()}`, valueAtStake: 500, requestedById: a.userId } });

  await withServer(async (call) => {
    const foreign = await call('GET', '/approval-requests?status=all', b.token);
    assert.equal(foreign.body.requests.filter((r: { id: string }) => r.id === request.id).length, 0, 'another company must not list this request');
    const own = await call('GET', '/approval-requests?status=all', a.token);
    assert.equal(own.body.requests.filter((r: { id: string }) => r.id === request.id).length, 1);

    const denied = await call('POST', `/approval-requests/${request.id}/decide`, b.token, { decision: 'APPROVED' });
    assert.notEqual(denied.status, 200, 'another company cannot approve');
    assert.match(String(denied.body.message), /not found/i, 'a foreign request looks exactly like a missing one');
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'PENDING', 'the request is untouched');

    const allowed = await call('POST', `/approval-requests/${request.id}/decide`, a.token, { decision: 'APPROVED' });
    assert.equal(allowed.status, 200, 'the identical call succeeds for the owner');
  });
});

integration('saved reports: shared reports stay inside their company and a foreign id deletes nothing', async () => {
  const a = await makeAdmin('sr-a');
  const b = await makeAdmin('sr-b');
  await withServer(async (call) => {
    const created = await call('POST', '/saved-reports', a.token, { name: 'Weekly stock', reportType: 'inventory', isShared: true });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.savedReport.id as string;
    assert.equal((await prisma.savedReport.findUniqueOrThrow({ where: { id } })).companyId, a.companyId, 'stamped with the real company');

    const foreignList = await call('GET', '/saved-reports', b.token);
    assert.equal(foreignList.body.savedReports.filter((r: { id: string }) => r.id === id).length, 0, 'a shared report must not leak to another company');

    const denied = await call('DELETE', `/saved-reports/${id}`, b.token);
    assert.equal(denied.status, 404, 'a foreign id is 404, not 403 or 204');
    assert.ok(await prisma.savedReport.findUnique({ where: { id } }), 'the report still exists');
    const allowed = await call('DELETE', `/saved-reports/${id}`, a.token);
    assert.equal(allowed.status, 204, 'the identical call succeeds for the owner');
  });
});

integration('serial numbers: lookup and movement are company scoped', async () => {
  const a = await makeAdmin('sn-a');
  const b = await makeAdmin('sn-b');
  const itemId = `sweep-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Serial item', unit: 'ea', companyId: a.companyId } });
  const serial = `SN-${randomUUID()}`;
  const record = await prisma.serialNumber.create({ data: { itemId, serial, companyId: a.companyId } });

  await withServer(async (call) => {
    const foreignGet = await call('GET', `/serials/${serial}`, b.token);
    assert.equal(foreignGet.status, 404, 'a foreign serial looks like a missing one');
    const foreignMove = await call('POST', `/serials/${serial}/move`, b.token, { toStatus: 'SOLD', movementType: 'SALE' });
    assert.equal(foreignMove.status, 404);
    assert.equal((await prisma.serialNumber.findUniqueOrThrow({ where: { id: record.id } })).status, 'IN_STOCK', 'the serial is untouched');
    const foreignList = await call('GET', `/items/${itemId}/serials`, b.token);
    assert.equal(foreignList.body.serials.length, 0, 'another company must not list this item\'s serials');

    const ownGet = await call('GET', `/serials/${serial}`, a.token);
    assert.equal(ownGet.status, 200, 'the identical lookup succeeds for the owner');
    const ownList = await call('GET', `/items/${itemId}/serials`, a.token);
    assert.equal(ownList.body.serials.length, 1);
  });
});
