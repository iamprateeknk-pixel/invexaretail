// Approval, tolerance and evidence rules can be limited to a branch, and every response joins that branch's name.
// POST/PATCH accepted any branchId, so an Admin of one company could attach another company's branch to a rule of
// their own and read that branch's name back. Another company's branch now resolves 404 (like a missing one) and no
// rule is created or changed. DB-only - skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import operationsExtensionRouter from './operations-extension.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

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
  const call: Api = async (method, path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
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

async function makeCompany() {
  const companyId = `rule-branch-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `rule-branch-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Rule Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Rule Admin', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const branch = await prisma.branch.create({ data: { code: `B-${randomUUID().slice(0, 8)}`, name: `Secret Branch ${randomUUID().slice(0, 6)}`, companyId } });
  return { companyId, userId, branchId: branch.id, branchName: branch.name, token: generateJWT(userId, companyId) };
}

const bodies: Array<[string, string, Record<string, unknown>]> = [
  ['approval-rules', 'approval', { label: 'Probe', triggerType: 'PO_APPROVE', valueThreshold: 1000, requiredApproverRole: 'ADMIN' }],
  ['tolerance-rules', 'tolerance', { label: 'Probe', valueThreshold: 100 }],
  ['evidence-rules', 'evidence', { label: 'Probe', triggerType: 'DAMAGED_RECEIPT', quantityThreshold: 5 }],
];

for (const [path, name, base] of bodies) {
  integration(`${name} rules: another company's branch id resolves 404 on create and edit, and the owner's own branch works`, async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    await withServer(async (call) => {
      const cross = await call('POST', `/${path}`, b.token, { ...base, branchId: a.branchId });
      assert.equal(cross.status, 404, "another company's branch must look like a missing one");
      assert.ok(!JSON.stringify(cross.body).includes(a.branchName));

      const own = await call('POST', `/${path}`, b.token, { ...base, branchId: b.branchId });
      assert.equal(own.status, 201, JSON.stringify(own.body));
      assert.equal(own.body.rule.branch.name, b.branchName);

      const retarget = await call('PATCH', `/${path}/${own.body.rule.id}`, b.token, { branchId: a.branchId });
      assert.equal(retarget.status, 404);
      const list = await call('GET', `/${path}`, b.token);
      assert.ok(!JSON.stringify(list.body).includes(a.branchName), "the other company's branch name is never returned");
    });
  });
}
