// Phase 8: the reprint-audit routes were not company-scoped. An admin of any
// company could read every company's print log, and could confirm another
// company's transfer existed by id. These tests pin the fix (404, never 403)
// and the extraction's unchanged behaviour for the owning company.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser, findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { createTransferRecord } from '../lib/repository.js';
import { reprintAuditLog } from '../lib/thermal-pdf.js';
import { extractToken } from './enterprise-auth.js';
import transferLabelsRouter from './transfer-labels.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

type Api = (path: string, token?: string) => Promise<{ status: number; body: any }>;

async function withServer(run: (get: Api, tokens: { a: string; b: string; companyA: string; companyB: string }) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(PASSWORD));
  const adminA = findUserByEmail('admin@retail.local')!;
  const emailB = `label-admin-b-${Math.random().toString(36).slice(2, 8)}@example.com`;
  createEnhancedUser({
    id: `user-${emailB}`, companyId: 'company-label-b', email: emailB, name: 'Admin B',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: hashPassword(PASSWORD), status: 'active',
  });
  const adminB = findUserByEmail(emailB)!;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', transferLabelsRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const get: Api = async (path, token) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(get, {
      a: generateJWT(adminA.id, adminA.companyId), b: generateJWT(adminB.id, adminB.companyId),
      companyA: adminA.companyId, companyB: adminB.companyId,
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function addTransfer(id: string, companyId: string) {
  createTransferRecord({
    id, sourceLocationId: 'wh-1', destinationLocationId: 'store-1', requestedBy: 'u', role: 'ADMIN', status: 'REQUESTED',
    lines: [{ itemId: 'item-1', lotId: 'lot-1', quantity: 1 }], createdAt: new Date().toISOString(), companyId,
  });
  reprintAuditLog.push({ transferId: id, printedBy: 'u', printTime: new Date().toISOString(), printCount: 1 });
}

test('the label routes require authentication', async () => {
  await withServer(async (get) => {
    assert.equal((await get('/transfers/reprint-audit/all')).status, 401);
    assert.equal((await get('/transfers/x/reprint-audit')).status, 401);
    assert.equal((await get('/transfers/x/label')).status, 401);
  });
});

test('reprint-audit/all only lists transfers owned by the caller\'s company', async () => {
  await withServer(async (get, t) => {
    const tag = Math.random().toString(36).slice(2, 8);
    addTransfer(`tr-a-${tag}`, t.companyA);
    addTransfer(`tr-b-${tag}`, t.companyB);
    const asA = (await get('/transfers/reprint-audit/all', t.a)).body.auditLog.map((entry: { transferId: string }) => entry.transferId);
    const asB = (await get('/transfers/reprint-audit/all', t.b)).body.auditLog.map((entry: { transferId: string }) => entry.transferId);
    assert.ok(asA.includes(`tr-a-${tag}`) && !asA.includes(`tr-b-${tag}`), 'company A must not see company B\'s print log');
    assert.ok(asB.includes(`tr-b-${tag}`) && !asB.includes(`tr-a-${tag}`), 'company B must not see company A\'s print log');
  });
});

test('another company\'s transfer id is a 404 on reprint-audit and label, not a 200 or 403', async () => {
  await withServer(async (get, t) => {
    const id = `tr-own-${Math.random().toString(36).slice(2, 8)}`;
    addTransfer(id, t.companyA);
    const cross = await get(`/transfers/${id}/reprint-audit`, t.b);
    assert.equal(cross.status, 404);
    assert.equal(cross.body.auditLog, undefined);
    assert.equal((await get(`/transfers/${id}/label`, t.b)).status, 404);
    const own = await get(`/transfers/${id}/reprint-audit`, t.a);
    assert.equal(own.status, 200, 'the owning company still reads its own log');
    assert.equal(own.body.auditLog.length, 1);
  });
});
