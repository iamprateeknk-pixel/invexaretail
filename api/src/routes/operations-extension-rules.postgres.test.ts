// Rule-threshold slice on real Postgres: (1) thresholds are Decimal(14,2) in the database yet stay JSON
// numbers on the wire; (2) approval/tolerance/evidence rules and QC templates are company scoped - a
// foreign company's list never contains them, a foreign id is a 404 (not 403), and another company's
// approval rule never gates this company's action. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { checkApprovalGate } from '../lib/approval-rules.js';
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

const createdUserIds: string[] = [];
// Rules and templates left behind would change other suites' behaviour (an active QC template makes
// QC mandatory), so every row this file creates is removed again.
test.after(async () => {
  if (!createdUserIds.length) return;
  await prisma.qcInspection.deleteMany({ where: { inspectedById: { in: createdUserIds } } });
  await prisma.qcChecklistTemplate.deleteMany({ where: { createdById: { in: createdUserIds } } });
  await prisma.approvalRequest.deleteMany({ where: { requestedById: { in: createdUserIds } } });
  await prisma.approvalRule.deleteMany({ where: { createdById: { in: createdUserIds } } });
  await prisma.toleranceRule.deleteMany({ where: { createdById: { in: createdUserIds } } });
  await prisma.evidenceRule.deleteMany({ where: { createdById: { in: createdUserIds } } });
});

async function makeAdmin(label: string) {
  const companyId = `rule-co-${label}-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `rule-admin-${label}-${randomUUID()}`;
  const email = `${userId}@test.invexa.local`;
  await prisma.user.create({ data: { id: userId, name: `Admin ${label}`, email, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email, name: `Admin ${label}`, role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  createdUserIds.push(userId);
  return { companyId, userId, token: generateJWT(userId, companyId) };
}

integration('rule thresholds are Decimal(14,2) in the database and JSON numbers on the wire', async () => {
  const a = await makeAdmin('dec');
  await withServer(async (call) => {
    for (const [path, body] of [
      ['/approval-rules', { label: 'A', triggerType: 'T', valueThreshold: 1234.567, requiredApproverRole: 'ADMIN' }],
      ['/tolerance-rules', { label: 'B', valueThreshold: 99.999, percentThreshold: 5 }],
      ['/evidence-rules', { label: 'C', triggerType: 'T', valueThreshold: 10.005 }],
    ] as const) {
      const created = await call('POST', path, a.token, body);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(typeof created.body.rule.valueThreshold, 'number', `${path} must not leak a Decimal string`);
    }
    const approval = await prisma.approvalRule.findFirstOrThrow({ where: { createdById: a.userId } });
    assert.equal(Number(approval.valueThreshold), 1234.57, 'rounded half-up to 2dp');
    const list = await call('GET', '/approval-rules', a.token);
    assert.equal(list.body.rules[0].valueThreshold, 1234.57);
    assert.equal(typeof list.body.rules[0].valueThreshold, 'number');
  });
});

integration('rules and QC templates are company scoped: foreign lists are empty, foreign ids are 404, foreign rules never gate', async () => {
  const a = await makeAdmin('a');
  const b = await makeAdmin('b');
  const triggerType = `scope-trigger-${randomUUID()}`;
  const rule = await prisma.approvalRule.create({ data: { label: 'A only', triggerType, valueThreshold: 100, requiredApproverRole: 'ADMIN', createdById: a.userId } });
  const tolerance = await prisma.toleranceRule.create({ data: { label: 'A tol', valueThreshold: 50, createdById: a.userId } });
  const evidence = await prisma.evidenceRule.create({ data: { label: 'A ev', triggerType, valueThreshold: 50, createdById: a.userId } });
  const template = await prisma.qcChecklistTemplate.create({ data: { label: 'A qc', checks: [{ key: 'seal', label: 'Seal' }], createdById: a.userId } });

  const sourceDocument = `PO-${randomUUID()}`;
  await prisma.qcInspection.create({ data: { templateId: template.id, sourceDocument, results: { seal: 'PASS' }, overallResult: 'PASS', inspectedById: a.userId } });

  await withServer(async (call) => {
    const foreignInspections = await call('GET', `/qc-inspections?sourceDocument=${sourceDocument}`, b.token);
    assert.equal(foreignInspections.body.inspections.length, 0, 'inspections of another company must not be listed');
    const ownInspections = await call('GET', `/qc-inspections?sourceDocument=${sourceDocument}`, a.token);
    assert.equal(ownInspections.body.inspections.length, 1);
    // Company B sees none of company A's configuration.
    for (const [path, key] of [['/approval-rules', 'rules'], ['/tolerance-rules', 'rules'], ['/evidence-rules', 'rules'], ['/qc-templates', 'templates']] as const) {
      const foreign = await call('GET', path, b.token);
      assert.equal(foreign.status, 200);
      assert.equal(foreign.body[key].filter((row: { label: string }) => row.label.startsWith('A ')).length, 0, `${path} leaked to another company`);
      const own = await call('GET', path, a.token);
      assert.ok(own.body[key].some((row: { label: string }) => row.label.startsWith('A')), `${path} must still list the owner's rows`);
    }

    // A foreign id resolves exactly like a missing one (404) and the row is untouched.
    for (const [path, id] of [['/approval-rules', rule.id], ['/tolerance-rules', tolerance.id], ['/evidence-rules', evidence.id], ['/qc-templates', template.id]] as const) {
      const denied = await call('PATCH', `${path}/${id}`, b.token, { active: false, label: 'hijacked' });
      assert.equal(denied.status, 404, `${path} must be 404, not 403, for a foreign id`);
      const allowed = await call('PATCH', `${path}/${id}`, a.token, { active: false });
      assert.equal(allowed.status, 200, `${path}: the identical call succeeds for the owner`);
    }
    assert.equal((await prisma.approvalRule.findUniqueOrThrow({ where: { id: rule.id } })).label, 'A only');
  });

  // Re-activate A's rule, then prove it gates A but never B.
  await prisma.approvalRule.update({ where: { id: rule.id }, data: { active: true } });
  const gateA = await checkApprovalGate({ triggerType, entityType: 'T', entityId: `e-${randomUUID()}`, branchId: null, value: 500, requestedById: a.userId, companyId: a.companyId });
  const gateB = await checkApprovalGate({ triggerType, entityType: 'T', entityId: `e-${randomUUID()}`, branchId: null, value: 500, requestedById: b.userId, companyId: b.companyId });
  assert.equal(gateA.blocked, true, 'the owner\'s rule gates the owner');
  assert.equal(gateB.blocked, false, 'another company\'s rule must never gate this company');
});
