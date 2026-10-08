// Bulk file imports matched items by code and branches by name against the process-wide lists, so one company's
// file could rewrite another company's item master, create items under the default company (persistItem had no
// company), and plan stock changes at another company's branches. Imports now resolve only the caller's own items
// and locations. Memory mode: the seed has a default-company admin and a separate company-jaipur admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { listItems, listLocations } from '../lib/repository.js';
import { JAIPUR_ITEM_ID, JAIPUR_LOCATION_ID, enforceOperationalCompanyScope, ownerOfItem, ownerOfLocation, scopedImportKey } from '../lib/saas/tenant-scope.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

async function withServer(run: (upload: (path: string, token: string, csv: string, fields?: Record<string, string>) => Promise<{ status: number; body: any }>, tokens: { owner: string; other: string }) => Promise<void>) {
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
  const upload = async (path: string, token: string, csv: string, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'import.csv');
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(upload, { owner: generateJWT(owner.id, owner.companyId), other: generateJWT(other.id, other.companyId) });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const defaultItem = () => listItems().find((item) => item.id !== JAIPUR_ITEM_ID && ownerOfItem(item.id) === 'default-company')!;

test("an item import never overwrites another company's item with the same code, and its new item belongs to the importer", async () => {
  const target = defaultItem();
  const nameBefore = target.name;
  await withServer(async (upload, { other }) => {
    const result = await upload('/import/items', other, `Code,Name\n${target.code},Hijacked Name\n`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(listItems().find((item) => item.id === target.id)!.name, nameBefore, "the other company's item was not renamed");
    const created = listItems().find((item) => item.code === target.code && item.id !== target.id);
    assert.ok(created, 'a separate item was created for the importing company');
    assert.equal(ownerOfItem(created!.id), 'company-jaipur', 'and it is owned by the importing company, not the default one');
    assert.equal(created!.name, 'Hijacked Name');
  });
});

test("a stock-update file cannot match another company's item or branch", async () => {
  const target = defaultItem();
  const branch = listLocations().find((location) => location.id !== JAIPUR_LOCATION_ID && ownerOfLocation(location.id) === 'default-company')!;
  await withServer(async (upload, { other }) => {
    const csv = `BRANCH NAME,ITEM CODE,ITEM NAME,LOT CODE,CLOSING STOCK\n${branch.name},${target.code},${target.name},LOT-X,5\n`;
    const result = await upload('/stock-adjustments/import/preview', other, csv, { mode: 'ADD' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const messages: string[] = result.body.preview.errors.map((error: { message: string }) => error.message);
    assert.ok(messages.some((message) => message === `Unknown branch/location: ${branch.name}`), `the other company's branch is unknown, got ${JSON.stringify(messages)}`);
    assert.equal(result.body.preview.validRows, 0, 'no row was planned against the other company');
  });
});

test('import-derived ids are namespaced for every company except the default one', () => {
  assert.equal(scopedImportKey('default-company', 'sku-1'), 'sku-1', 'the default company keeps its existing ids');
  assert.equal(scopedImportKey('company-jaipur', 'sku-1'), 'company-jaipur|sku-1');
  assert.notEqual(scopedImportKey('company-a', 'sku-1'), scopedImportKey('company-b', 'sku-1'));
});
