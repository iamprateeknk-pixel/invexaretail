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
  await prisma.user.create({ data: { id: requesterId, name: 'Requester', email: `${requesterId}@test.invexa.local`, passwordHash: 'x', role: 'STORE_USER', assignedLocations: '[]', companyId } });
  await prisma.user.create({ data: { id: approverId, name: 'Approver', email: `${approverId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: approverId, companyId, email: `${approverId}@test.invexa.local`, name: 'Approver', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const token = generateJWT(approverId, companyId);

  const triggerType = `ard-trigger-${randomUUID()}`;
  await prisma.approvalRule.create({
    data: { label: 'Decimal pilot rule', triggerType, valueThreshold: 100, requiredApproverRole: 'ADMIN', createdById: approverId },
  });

  const entityId = `ard-entity-${randomUUID()}`;
  const gate = await checkApprovalGate({
    triggerType, entityType: 'TestEntity', entityId, branchId: null,
    value: 1234.567, requestedById: requesterId, companyId, // deliberately 3 decimal places to exercise the 2dp rounding policy
  });
  assert.equal(gate.blocked, true, JSON.stringify(gate));

  const stored = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: (gate as { requestId: string }).requestId } });
  assert.equal(Number(stored.valueAtStake), 1234.57, 'round-half-up to 2dp per the money rounding policy');

  await withServer(async (call) => {
    const list = await call('GET', '/approval-requests?status=PENDING', token);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const row = list.body.requests.find((r: { id: string }) => r.id === (gate as { requestId: string }).requestId);
    assert.ok(row, 'the pending request must appear');
    assert.equal(typeof row.valueAtStake, 'number', 'must serialize as a JSON number, not a Decimal string');
    assert.equal(row.valueAtStake, 1234.57);

    const decided = await call('POST', `/approval-requests/${row.id}/decide`, token, { decision: 'APPROVED' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(typeof decided.body.request.valueAtStake, 'number');
    assert.equal(decided.body.request.valueAtStake, 1234.57);
  });
});
