// Decimal migration pilot (docs/decimal-migration-plan.md): ApprovalRequest.valueAtStake is the
// first Float field converted to Decimal. Proves the rounding policy (round-half-up to 2dp) at
// the database layer and that both API routes serving this field (GET /approval-requests,
// POST /approval-requests/:id/decide) still return it as a JSON number, not the string
// Prisma.Decimal's default toJSON would otherwise silently produce. Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { generateJWT } from './otp-auth.js';
import { createEnhancedUser } from './enterprise-repository.js';
import { checkApprovalGate } from './approval-rules.js';
import operationsExtensionRouter from '../routes/operations-extension.js';

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

integration('valueAtStake rounds to 2dp in the database and serializes as a JSON number, not a Decimal string', async () => {
  const companyId = `ard-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const requesterId = `ard-req-${randomUUID()}`;
  const approverId = `ard-app-${randomUUID()}`;
  await prisma.user.create({ data: { id: requesterId, name: 'Requester', email: `${requesterId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  await prisma.user.create({ data: { id: approverId, name: 'Approver', email: `${approverId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: approverId, companyId, email: `${approverId}@test.invexa.local`, name: 'Approver', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  createEnhancedUser({ id: requesterId, companyId, email: `${requesterId}@test.invexa.local`, name: 'Requester', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const token = generateJWT(approverId, companyId);

  const branch = await prisma.branch.create({ data: { code: companyId, name: 'Approval branch', companyId } });
  const location = await prisma.location.create({
    data: { code: companyId, name: 'Approval location', type: 'WAREHOUSE', companyId, branchId: branch.id },
  });
  const triggerType = `ard-trigger-${randomUUID()}`;
  const rule = await prisma.approvalRule.create({
    data: { label: 'Decimal pilot rule', triggerType, valueThreshold: 100, requiredApproverRole: 'ADMIN', createdById: approverId, branchId: branch.id },
  });

  const entityId = `ard-entity-${randomUUID()}`;
  await assert.rejects(checkApprovalGate({
    triggerType, entityType: 'TestEntity', entityId, locationId: location.id,
    value: async () => { throw new Error('Valuation store unavailable'); },
    requestedById: requesterId, companyId, intent: ['lot-a'],
  }), { code: 'APPROVAL_UNAVAILABLE' });
  assert.equal(await prisma.approvalRequest.count({ where: { entityId } }), 0);

  await prisma.approvalRequest.create({ data: {
    triggerType, entityType: 'TestEntity', entityId, ruleId: rule.id, status: 'APPROVED',
    valueAtStake: 1234.57, requestedById: requesterId, decidedById: approverId,
  } });
  const command = {
    triggerType, entityType: 'TestEntity', entityId, locationId: location.id,
    value: 1234.567, requestedById: requesterId, companyId, intent: ['lot-a'],
  };
  const [gate, retry] = await Promise.all([checkApprovalGate(command), checkApprovalGate(command)]);
  assert.ok(gate.blocked && retry.blocked, 'legacy approval cannot authorize a new command');
  assert.equal(retry.requestId, gate.requestId, 'concurrent identical commands share one approval request');
  assert.equal(await prisma.auditLog.count({ where: { entityId, action: 'APPROVAL_REQUESTED' } }), 1);

  const stored = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: (gate as { requestId: string }).requestId } });
  assert.equal(Number(stored.valueAtStake), 1234.57, 'round-half-up to 2dp per the money rounding policy');

  await withServer(async (call) => {
    const list = await call('GET', '/approval-requests?status=PENDING', token);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const row = list.body.requests.find((r: { id: string }) => r.id === (gate as { requestId: string }).requestId);
    assert.ok(row, 'the pending request must appear');
    assert.equal(typeof row.valueAtStake, 'number', 'must serialize as a JSON number, not a Decimal string');
    assert.equal(row.valueAtStake, 1234.57);

    const selfReview = await call('POST', `/approval-requests/${row.id}/decide`, generateJWT(requesterId, companyId), { decision: 'APPROVED' });
    assert.equal(selfReview.status, 403, JSON.stringify(selfReview.body));
    assert.equal(selfReview.body.code, 'SELF_REVIEW');
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).status, 'PENDING');

    const attempts = await Promise.all([
      call('POST', `/approval-requests/${row.id}/decide`, token, { decision: 'APPROVED' }),
      call('POST', `/approval-requests/${row.id}/decide`, token, { decision: 'REJECTED' }),
    ]);
    assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409]);
    const decided = attempts.find((response) => response.status === 200)!;
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(typeof decided.body.request.valueAtStake, 'number');
    assert.equal(decided.body.request.valueAtStake, 1234.57);
    const final = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(final.status, decided.body.request.status);
    const audit = await prisma.auditLog.findMany({
      where: { entityId, action: { in: ['APPROVAL_APPROVED', 'APPROVAL_REJECTED'] } },
    });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, `APPROVAL_${final.status}`);

    if (final.status === 'REJECTED') {
      const newGate = await checkApprovalGate(command);
      assert.ok(newGate.blocked);
      const approved = await call('POST', `/approval-requests/${newGate.requestId}/decide`, token, { decision: 'APPROVED' });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
    }
    assert.equal((await checkApprovalGate(command)).blocked, false, 'only the approved intent can proceed');
    const changed = await checkApprovalGate({ ...command, intent: ['lot-b'] });
    assert.ok(changed.blocked, 'a different lot needs approval even when its value is identical');
    assert.notEqual(changed.requestId, gate.requestId);
    assert.ok((await checkApprovalGate({ ...command, requestedById: approverId })).blocked,
      'a different requester cannot reuse the decision');
    await prisma.approvalRule.update({ where: { id: rule.id }, data: { valueThreshold: 110 } });
    assert.ok((await checkApprovalGate(command)).blocked, 'a changed approval rule requires a new review');
  });
});

integration('live Studio approvals use the published company version and keep a stricter legacy gate', async () => {
  const companyId = `wf-co-${randomUUID()}`;
  const requester = `wf-user-${randomUUID()}`;
  const reviewer = `wf-reviewer-${randomUUID()}`;
  const manager = `wf-manager-${randomUUID()}`;
  const locationId = `wf-location-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Workflow location', type: 'STORE', companyId } });
  for (const id of [requester, reviewer, manager]) {
    const email = `${id}@test.invexa.local`;
    const role = id === manager ? 'BRANCH_MANAGER' : 'ADMIN';
    await prisma.user.create({ data: { id, name: id, email, passwordHash: 'x', role, assignedLocations: '[]', companyId } });
    createEnhancedUser({ id, companyId, email, name: id, passwordHash: 'x', role, branchIds: [], locationIds: [], status: 'active' });
  }
  const versionId = randomUUID();
  const workflow = { key: 'purchase.approval', name: 'Purchase limit', enforce: true, graph: { nodes: [
    { type: 'trigger', config: { event: 'purchase_order.created' } },
    { type: 'condition', config: { field: 'value', op: 'lte', amount: 100 } },
    { type: 'approval', config: { role: 'BRANCH_MANAGER' } },
  ] } };
  const input = {
    triggerType: 'PO_APPROVE', entityType: 'PurchaseOrder', entityId: randomUUID(),
    value: 101, intent: ['order revision'], requestedById: requester, companyId, locationId,
  };
  await prisma.controlPlaneConfig.create({ data: { versionId, companyId, version: 2, kind: 'draft', status: 'draft', payload: { workflows: [workflow] } } });
  assert.equal((await checkApprovalGate(input)).blocked, false);
  await prisma.controlPlaneConfig.create({ data: { versionId, companyId, version: 2, kind: 'published', status: 'published', payload: { workflows: [workflow] } } });
  assert.equal((await checkApprovalGate({ ...input, value: 100 })).blocked, false);
  const blocked = await checkApprovalGate(input);
  assert.ok(blocked.blocked);
  assert.equal(blocked.requiredApproverRole, 'BRANCH_MANAGER');
  await withServer(async (call) => {
    const managerToken = generateJWT(manager, companyId);
    const outside = await call('GET', '/approval-requests', managerToken);
    assert.equal(outside.status, 200);
    assert.deepEqual(outside.body.requests, []);
    const denied = await call('POST', `/approval-requests/${blocked.requestId}/decide`, managerToken, { decision: 'APPROVED' });
    assert.equal(denied.status, 409);
    assert.match(denied.body.message, /not found/i);
    const token = generateJWT(reviewer, companyId);
    const list = await call('GET', '/approval-requests', token);
    const row = list.body.requests.find((request: { id: string }) => request.id === blocked.requestId);
    assert.equal(row?.rule.label, 'Purchase limit');
    assert.equal(row.workflowPolicy.configVersion, 2);
    assert.equal(row.ruleId, null);
    const decided = await call('POST', `/approval-requests/${blocked.requestId}/decide`, token, { decision: 'APPROVED' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
  });
  assert.equal((await checkApprovalGate(input)).blocked, false);
  await prisma.approvalRule.create({ data: { label: 'Legacy admin gate', triggerType: input.triggerType, requiredApproverRole: 'ADMIN', valueThreshold: 100, createdById: reviewer } });
  const stricter = await checkApprovalGate(input);
  assert.ok(stricter.blocked);
  assert.equal(stricter.requiredApproverRole, 'ADMIN');
});
