// Several GET endpoints in core.ts returned a process-wide list to any admin: the audit trail, the CSV exports,
// the sync status, the all-location expiry dashboard and the count-assignment list. An admin of one company
// could read another company's items, counts, transfers, locations and audit events. Each must now return only
// the caller's own company's data. Memory mode: the seed has a default-company admin and a separate
// company-jaipur admin whose location is loc-jaipur-1 and item is item-jaipur-1.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { recordAudit } from '../lib/audit.js';
import { createCountAssignment, createCountRecord, createTransferRecord, listItems, listLocations } from '../lib/repository.js';
import { JAIPUR_ITEM_ID, JAIPUR_LOCATION_ID, enforceOperationalCompanyScope, ownerOfItem, ownerOfLocation } from '../lib/saas/tenant-scope.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

type Get = (path: string, token: string) => Promise<{ status: number; text: string; json: any }>;

async function withServer(run: (get: Get, who: { owner: { token: string; id: string }; other: { token: string; id: string } }) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const owner = findUserByEmail('admin@retail.local')!;
  const other = findUserByEmail('admin@jaipur.local')!;
  assert.notEqual(owner.companyId, other.companyId);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const get: Get = async (path, token) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await response.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* CSV */ }
    return { status: response.status, text, json };
  };
  try {
    await run(get, {
      owner: { token: generateJWT(owner.id, owner.companyId), id: owner.id },
      other: { token: generateJWT(other.id, other.companyId), id: other.id },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const tag = Math.random().toString(36).slice(2, 8);
const ownerLocationId = () => listLocations().find((location) => location.id !== JAIPUR_LOCATION_ID && ownerOfLocation(location.id) === 'default-company')!.id;
const ownerItem = () => listItems().find((item) => item.id !== JAIPUR_ITEM_ID && ownerOfItem(item.id) === 'default-company')!;

test("GET /audit shows only events made by the caller's own company's users", async () => {
  await withServer(async (get, { owner, other }) => {
    recordAudit({ actorId: owner.id, actorRole: 'ADMIN', action: `OWN_${tag}`, entityType: 'Test', entityId: 'x' });
    recordAudit({ actorId: other.id, actorRole: 'ADMIN', action: `OTHER_${tag}`, entityType: 'Test', entityId: 'x' });
    const ownerActions = (await get('/audit', owner.token)).json.events.map((event: { action: string }) => event.action);
    assert.ok(ownerActions.includes(`OWN_${tag}`));
    assert.ok(!ownerActions.includes(`OTHER_${tag}`), "another company's audit event is not shown");
    const otherActions = (await get('/audit', other.token)).json.events.map((event: { action: string }) => event.action);
    assert.ok(otherActions.includes(`OTHER_${tag}`));
    assert.ok(!otherActions.includes(`OWN_${tag}`));
  });
});

test("GET /export/stock, /export/counts and /export/transfers contain only the caller's own company's rows", async () => {
  const item = ownerItem();
  const countId = `cnt-own-${tag}`;
  const transferId = `trf-own-${tag}`;
  const jaipurCountId = `cnt-jpr-${tag}`;
  const jaipurTransferId = `trf-jpr-${tag}`;
  const base = { physicalQuantity: 1, bookQty: 1, mode: 'manual' as const, submittedBy: 'test', role: 'STORE_USER' as const, createdAt: new Date().toISOString() };
  createCountRecord({ ...base, id: countId, itemId: item.id, lotId: item.lots[0]?.id ?? 'lot', locationId: ownerLocationId() });
  createCountRecord({ ...base, id: jaipurCountId, itemId: JAIPUR_ITEM_ID, lotId: 'lot-jaipur-1', locationId: JAIPUR_LOCATION_ID });
  const transfer = { requestedBy: 'test', role: 'ADMIN' as const, status: 'REQUESTED' as const, lines: [{ itemId: item.id, lotId: 'lot', quantity: 1 }], createdAt: new Date().toISOString() };
  createTransferRecord({ ...transfer, id: transferId, sourceLocationId: ownerLocationId(), destinationLocationId: ownerLocationId() } as any);
  createTransferRecord({ ...transfer, id: jaipurTransferId, sourceLocationId: JAIPUR_LOCATION_ID, destinationLocationId: JAIPUR_LOCATION_ID } as any);

  await withServer(async (get, { owner, other }) => {
    const stockOwner = (await get('/export/stock', owner.token)).text;
    assert.ok(stockOwner.includes(item.code), 'the owner exports its own items');
    assert.ok(!stockOwner.includes('SKU-JPR-1'), "the other company's item is not exported");
    const stockOther = (await get('/export/stock', other.token)).text;
    assert.ok(stockOther.includes('SKU-JPR-1'));
    assert.ok(!stockOther.includes(item.code), "the first company's item is not exported");

    const countsOwner = (await get('/export/counts', owner.token)).text;
    assert.ok(countsOwner.includes(countId) && !countsOwner.includes(jaipurCountId));
    const countsOther = (await get('/export/counts', other.token)).text;
    assert.ok(countsOther.includes(jaipurCountId) && !countsOther.includes(countId));

    const transfersOwner = (await get('/export/transfers', owner.token)).text;
    assert.ok(transfersOwner.includes(transferId) && !transfersOwner.includes(jaipurTransferId));
    const transfersOther = (await get('/export/transfers', other.token)).text;
    assert.ok(transfersOther.includes(jaipurTransferId) && !transfersOther.includes(transferId));
  });
});

test("GET /sync-status lists only the caller's own company's locations", async () => {
  await withServer(async (get, { owner, other }) => {
    const ownerIds = (await get('/sync-status', owner.token)).json.locations.map((location: { locationId: string }) => location.locationId);
    assert.ok(ownerIds.includes(ownerLocationId()) && !ownerIds.includes(JAIPUR_LOCATION_ID));
    const otherIds = (await get('/sync-status', other.token)).json.locations.map((location: { locationId: string }) => location.locationId);
    assert.ok(otherIds.includes(JAIPUR_LOCATION_ID) && !otherIds.includes(ownerLocationId()));
  });
});

test("GET /count-assignments shows an admin only their own company's tasks", async () => {
  const mine = `asg-own-${tag}`;
  const theirs = `asg-jpr-${tag}`;
  const base = { assignedToId: 'u', assignedById: 'u', countDate: new Date().toISOString() };
  createCountAssignment({ ...base, id: mine, locationId: ownerLocationId(), itemId: ownerItem().id });
  createCountAssignment({ ...base, id: theirs, locationId: JAIPUR_LOCATION_ID, itemId: JAIPUR_ITEM_ID });
  await withServer(async (get, { owner, other }) => {
    const ownerIds = (await get('/count-assignments', owner.token)).json.assignments.map((assignment: { id: string }) => assignment.id);
    assert.ok(ownerIds.includes(mine) && !ownerIds.includes(theirs));
    const otherIds = (await get('/count-assignments', other.token)).json.assignments.map((assignment: { id: string }) => assignment.id);
    assert.ok(otherIds.includes(theirs) && !otherIds.includes(mine));
  });
});
