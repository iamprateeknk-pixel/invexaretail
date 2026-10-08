// A transfer file is matched row by row to items by code/barcode/name. The match used the process-wide item list,
// so a file uploaded by one company could resolve to ANOTHER company's item and plan stock allocations for it. Only
// the caller's own company's items may match; another company's code is "unknown". Memory mode: the seed has a
// default-company admin and a separate company-jaipur admin whose location is loc-jaipur-1.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { listItems } from '../lib/repository.js';
import { JAIPUR_ITEM_ID, JAIPUR_LOCATION_ID, enforceOperationalCompanyScope, ownerOfItem } from '../lib/saas/tenant-scope.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

async function withServer(run: (preview: (token: string, csv: string) => Promise<{ status: number; body: any }>, tokens: { owner: string; other: string }) => Promise<void>) {
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
  const preview = async (token: string, csv: string) => {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'transfer.csv');
    form.append('sourceLocationId', JAIPUR_LOCATION_ID);
    form.append('destinationLocationId', JAIPUR_LOCATION_ID);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/transfers/import/preview`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(preview, { owner: generateJWT(owner.id, owner.companyId), other: generateJWT(other.id, other.companyId) });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("a transfer file from one company never resolves to another company's item", async () => {
  const foreign = listItems().find((item) => item.id !== JAIPUR_ITEM_ID && ownerOfItem(item.id) === 'default-company')!;
  const own = listItems().find((item) => item.id === JAIPUR_ITEM_ID)!;
  await withServer(async (preview, { other }) => {
    const result = await preview(other, `Item Code,Requested Qty\n${foreign.code},1\n${own.code},1\n`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const messages = result.body.preview.errors.map((error: { message: string }) => error.message);
    assert.ok(messages.some((message: string) => message === `Unknown Item Code: ${foreign.code}`), `the other company's code is unknown, got: ${JSON.stringify(messages)}`);
    assert.ok(!messages.some((message: string) => message.includes(foreign.name)), "the other company's item is never named");
    assert.ok(!result.body.preview.rows.some((row: { itemId: string }) => row.itemId === foreign.id), "and never planned");
  });
});
