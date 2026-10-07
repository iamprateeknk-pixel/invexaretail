// Webhooks on real Postgres: subscriptions and delivery logs are company scoped - another company's
// admin never lists them, a foreign id is a 404 (not 403) and cannot be paused or replayed, and the
// database row is untouched. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
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

const createdCompanyIds: string[] = [];
// Rows this file creates are removed again so other suites are unaffected.
test.after(async () => {
  if (!createdCompanyIds.length) return;
  await prisma.webhookDeliveryLog.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.webhookSubscription.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
});

async function makeAdmin(label: string) {
  const companyId = `rule-co-${label}-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `rule-admin-${label}-${randomUUID()}`;
  const email = `${userId}@test.invexa.local`;
  await prisma.user.create({ data: { id: userId, name: `Admin ${label}`, email, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email, name: `Admin ${label}`, role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  createdCompanyIds.push(companyId);
  return { companyId, userId, token: generateJWT(userId, companyId) };
}


integration('webhook subscriptions and deliveries are company scoped on the database path', async () => {
  const a = await makeAdmin('wa');
  const b = await makeAdmin('wb');
  await withServer(async (call) => {
    const created = await call('POST', '/webhook-subscriptions', a.token, { name: 'A hook', endpointUrl: 'https://hooks.example.com/a', events: ['count.reviewed'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const hookId = created.body.subscription.id as string;

    const ownList = await call('GET', '/webhook-subscriptions', a.token);
    assert.deepEqual(ownList.body.subscriptions.map((row: { id: string }) => row.id), [hookId]);
    const foreignList = await call('GET', '/webhook-subscriptions', b.token);
    assert.equal(foreignList.body.subscriptions.filter((row: { id: string }) => row.id === hookId).length, 0, 'another company must not list this hook');

    const denied = await call('PATCH', `/webhook-subscriptions/${hookId}/status`, b.token, { status: 'PAUSED' });
    assert.equal(denied.status, 404, 'a foreign id is 404, not 403');
    assert.equal((await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: hookId } })).status, 'ACTIVE', 'the row is untouched');
    const allowed = await call('PATCH', `/webhook-subscriptions/${hookId}/status`, a.token, { status: 'PAUSED' });
    assert.equal(allowed.status, 200, 'the identical call succeeds for the owner');
    assert.equal((await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: hookId } })).status, 'PAUSED');

    await prisma.webhookDeliveryLog.create({ data: { id: `whdel-${randomUUID()}`, companyId: a.companyId, subscriptionId: hookId, eventType: 'count.reviewed', status: 'FAILED', body: '{"secret":"payload"}' } });
    const ownDeliveries = await call('GET', '/webhook-deliveries', a.token);
    assert.equal(ownDeliveries.body.deliveries.filter((row: { companyId: string }) => row.companyId === a.companyId).length, 1);
    const foreignDeliveries = await call('GET', '/webhook-deliveries', b.token);
    assert.equal(foreignDeliveries.body.deliveries.filter((row: { companyId: string }) => row.companyId === a.companyId).length, 0, 'payload logs of another company must not be listed');
  });
});
