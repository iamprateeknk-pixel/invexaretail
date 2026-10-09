// Daily purchase import: the admin can choose, at import time, which of the company's locations the purchase is
// received into. Without a choice it goes to the configured H.O. Basni warehouse, as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { listItems, listLocations, listStockLedgerForLocation } from '../lib/repository.js';
import { JAIPUR_ITEM_ID, JAIPUR_LOCATION_ID, enforceOperationalCompanyScope, ownerOfItem, ownerOfLocation } from '../lib/saas/tenant-scope.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

type Call = (path: string, token: string, csv?: string, fields?: Record<string, string>, json?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Call, token: string) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const admin = findUserByEmail('admin@retail.local')!;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const call: Call = async (path, token, csv, fields = {}, json) => {
    const url = `http://127.0.0.1:${port}/api/v1${path}`;
    if (csv === undefined) {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(json ?? {}) });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    }
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'purchase.csv');
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(call, generateJWT(admin.id, admin.companyId));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const ownItem = () => listItems().find((item) => item.id !== JAIPUR_ITEM_ID && ownerOfItem(item.id) === 'default-company')!;
const ownLocations = () => listLocations().filter((location) => location.id !== JAIPUR_LOCATION_ID && ownerOfLocation(location.id) === 'default-company');
const purchaseCsv = (billNo: string, lot: string, qty = 5) => `Bill Date,Bill No.,Item Code,Item Name,Lot No.,Total Qty\n11/09/2026,${billNo},${ownItem().code},${ownItem().name},${lot},${qty}\n`;

test('without a choice the purchase goes to the configured warehouse', async () => {
  const warehouse = ownLocations().find((location) => location.type === 'warehouse')!;
  await withServer(async (call, token) => {
    const preview = await call('/imports/purchases/preview', token, purchaseCsv('DEF-1', 'LOT-DEF'));
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.preview.invalidRows, 0, JSON.stringify(preview.body.preview.errors));
    assert.equal(preview.body.preview.sample[0].locationId, warehouse.id);
  });
});

test('the admin can choose a branch to receive the purchase into, and the stock lands there', async () => {
  const branch = ownLocations().find((location) => location.type !== 'warehouse')!;
  await withServer(async (call, token) => {
    const preview = await call('/imports/purchases/preview', token, purchaseCsv('BR-1', 'LOT-BR', 7), { destinationLocationId: branch.id });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.preview.invalidRows, 0, JSON.stringify(preview.body.preview.errors));
    assert.equal(preview.body.preview.sample[0].locationId, branch.id, 'a branch is allowed when chosen on purpose');

    const commit = await call(`/imports/${preview.body.batchToken}/commit`, token);
    assert.equal(commit.status, 201, JSON.stringify(commit.body));
    assert.match(commit.body.message, new RegExp(`Purchase received into ${branch.name}`));
    const landed = listStockLedgerForLocation(branch.id).find((entry) => entry.itemId === ownItem().id && entry.onHand >= 7);
    assert.ok(landed, 'the purchased quantity is on hand at the chosen branch');
  });
});

test('the same file received into a different location is a separate import', async () => {
  const [first, second] = ownLocations();
  await withServer(async (call, token) => {
    const csv = purchaseCsv('DUP-1', 'LOT-DUP', 3);
    const a = await call('/imports/purchases/preview', token, csv, { destinationLocationId: first.id });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await call('/imports/purchases/preview', token, csv, { destinationLocationId: second.id });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.notEqual(a.body.batchToken, b.body.batchToken, 'a different destination is a different import');
  });
});

test("another company's location, or a made-up one, is refused", async () => {
  await withServer(async (call, token) => {
    const foreign = await call('/imports/purchases/preview', token, purchaseCsv('X-1', 'LOT-X'), { destinationLocationId: JAIPUR_LOCATION_ID });
    assert.equal(foreign.status, 400);
    assert.match(foreign.body.message, /one of your own locations/);
    const unknown = await call('/imports/purchases/preview', token, purchaseCsv('X-2', 'LOT-X'), { destinationLocationId: 'no-such-location' });
    assert.equal(unknown.status, 400);
  });
});

test('a sales import ignores the destination field', async () => {
  const branch = ownLocations().find((location) => location.type !== 'warehouse')!;
  await withServer(async (call, token) => {
    const csv = `Branch Name,Bill Date,Bill No.,Item Code,Item Name,Total Qty\n${branch.name},11/09/2026,S-1,${ownItem().code},${ownItem().name},1\n`;
    const preview = await call('/imports/sales/preview', token, csv, { destinationLocationId: 'ignored-for-sales' });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
  });
});
