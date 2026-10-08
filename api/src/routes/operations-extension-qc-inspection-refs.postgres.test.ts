// POST /qc-inspections stores the inspection under the caller's company, but GET /qc-inspections joins its template and
// lot. templateId and lotId were not checked, so one company could attach another company's checklist template or lot
// to an inspection and read the template label / lot number back. Both must now resolve inside the caller's company
// (another company's id looks like a missing one: 404). DB-only - skipped unless TEST_DATABASE_URL is set.
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
  const companyId = `qc-refs-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `qc-refs-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'QC Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'QC Admin', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const itemId = `qc-refs-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'QC Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { id: `qc-refs-lot-${randomUUID()}`, lotNo: `SECRET-LOT-${randomUUID().slice(0, 6)}`, itemId } });
  const template = await prisma.qcChecklistTemplate.create({ data: { label: `Secret template ${randomUUID().slice(0, 6)}`, checks: [{ key: 'seal', label: 'Seal intact' }], createdById: userId } });
  return { companyId, userId, lotId: lot.id, lotNo: lot.lotNo, templateId: template.id, templateLabel: template.label, token: generateJWT(userId, companyId) };
}

integration("POST /qc-inspections: another company's template or lot resolves 404 and nothing is stored; the owner's own work", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const results = { seal: 'PASS' };
  await withServer(async (call) => {
    const foreignTemplate = await call('POST', '/qc-inspections', b.token, { templateId: a.templateId, results });
    assert.equal(foreignTemplate.status, 404);
    const foreignLot = await call('POST', '/qc-inspections', b.token, { lotId: a.lotId, results });
    assert.equal(foreignLot.status, 404);
    assert.equal(await prisma.qcInspection.count({ where: { inspectedBy: { companyId: b.companyId } } }), 0, 'nothing was stored for company B');

    const own = await call('POST', '/qc-inspections', b.token, { templateId: b.templateId, lotId: b.lotId, results });
    assert.equal(own.status, 201, JSON.stringify(own.body));
    const list = await call('GET', '/qc-inspections', b.token);
    const text = JSON.stringify(list.body);
    assert.ok(!text.includes(a.templateLabel) && !text.includes(a.lotNo), "the other company's template label and lot number are never returned");
  });
});
