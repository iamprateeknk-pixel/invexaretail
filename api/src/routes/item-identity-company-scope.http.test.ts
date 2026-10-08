// Item codes, barcodes and aliases are unique PER COMPANY (the database enforces (companyId, code)). POST/PUT /items
// checked them against the process-wide item list, so one company could not use a code another company already
// had, and the 409 message named the other company's item (its code and name). Each company now checks only its own
// items. Memory mode: the seed has a default-company admin and a separate company-jaipur admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { listItems } from '../lib/repository.js';
import { JAIPUR_ITEM_ID, enforceOperationalCompanyScope, ownerOfItem } from '../lib/saas/tenant-scope.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

type Call = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Call, tokens: { owner: string; other: string }) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const owner = findUserByEmail('admin@retail.local')!;
  const other = findUserByEmail('admin@jaipur.local')!;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const call: Call = async (method, path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(call, { owner: generateJWT(owner.id, owner.companyId), other: generateJWT(other.id, other.companyId) });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("a company can use an item code another company already has, and is never told about the other company's item", async () => {
  const ownerItem = listItems().find((item) => item.id !== JAIPUR_ITEM_ID && ownerOfItem(item.id) === 'default-company')!;
  await withServer(async (call, { owner, other }) => {
    // The other company creates an item with the SAME code and barcode as the default company's item.
    const created = await call('POST', '/items', other, { code: ownerItem.code, name: 'Jaipur twin', barcode: ownerItem.barcode ?? undefined });
    assert.equal(created.status, 201, `expected 201, got ${created.status}: ${JSON.stringify(created.body)}`);
    assert.ok(!JSON.stringify(created.body).includes(ownerItem.name), "the other company's item name is not echoed");

    // Within one company a duplicate is still refused.
    const duplicate = await call('POST', '/items', other, { code: ownerItem.code, name: 'Jaipur duplicate' });
    assert.equal(duplicate.status, 409);
    assert.ok(duplicate.body.message.includes('Jaipur twin'), 'the conflict names the company\'s OWN item');
    assert.ok(!duplicate.body.message.includes(ownerItem.name), "and never the other company's");

    // Renaming to a code only the other company uses is allowed too.
    const rename = await call('PUT', `/items/${created.body.item.id}`, other, { code: `${ownerItem.code}-JPR` });
    assert.equal(rename.status, 200, JSON.stringify(rename.body));
    const rejoin = await call('PUT', `/items/${ownerItem.id}`, owner, { code: `${ownerItem.code}-JPR` });
    assert.equal(rejoin.status, 200, 'the default company may take a code the other company happens to use');
    await call('PUT', `/items/${ownerItem.id}`, owner, { code: ownerItem.code }); // restore for other tests
  });
});
