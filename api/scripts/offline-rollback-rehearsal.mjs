#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import net from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const transferId = 'transfer-2';
const companyId = 'default-company';
const receivePath = `/api/v1/transfers/${transferId}/receive`;
const syncPath = '/api/v1/sync/commands';
const migrationRecords = 'SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name';

export function disposableDatabaseUrl(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      !/^\/invexa_rollback_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('Use a fresh loopback PostgreSQL database named invexa_rollback_<run>.');
  }
  return url.toString();
}

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function withApi(directory, env, scenario) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: directory, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let diagnostics = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-12_000); });
  }
  const exited = new Promise((resolveExit) => {
    child.once('error', resolveExit);
    child.once('exit', resolveExit);
  });
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.pid === undefined) break;
      const ready = await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
      if (ready) await ready.arrayBuffer();
      if (ready?.ok) return await scenario(origin);
      await delay(250);
    }
    throw new Error(`Built API failed readiness in ${directory}.\n${diagnostics}`);
  } finally {
    if (child.exitCode === null && child.pid !== undefined) child.kill();
    await exited;
  }
}

async function request(origin, path, { token, body, status = 200 } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, status, `${path}: expected ${status}, got ${response.status} (${data.code ?? 'no code'})`);
  return data;
}

async function signIn(origin, password) {
  const result = await request(origin, '/api/v1/auth/login', { body: { email: 'admin@retail.local', password } });
  assert.equal(typeof result.token, 'string', 'fixture admin must have a session');
  return result.token;
}

async function publishReceivingPolicy(origin, password, allowReceiving) {
  const platform = await request(origin, '/control/v1/auth/login', {
    body: { email: 'superadmin@invexa.local', password },
  });
  const scoped = await request(origin, '/control/v1/sessions/select-company', {
    token: platform.token, body: { companyId },
  });
  await request(origin, '/studio/v1/mobile-policy', { token: scoped.token, body: {
    role: 'ADMIN', offlineMaxHours: 2, syncScope: allowReceiving ? ['stock', 'receiving'] : ['stock'],
    navigation: ['stock'], encryptedLocalStore: true,
  } });
  await request(origin, '/studio/v1/publish', { token: scoped.token, body: {} });
}

async function receivingRevision(origin, token) {
  const { transfers } = await request(origin, '/api/v1/transfers/list', { token });
  const transfer = transfers.find((entry) => entry.id === transferId);
  assert.match(transfer?.receiveRevision ?? '', /^[a-f0-9]{64}$/);
  return transfer.receiveRevision;
}

function queuedReceipt(permit, revision, receivedQty) {
  return {
    contractVersion: 2, type: 'RECEIVE_CONFIRM', commandId: randomUUID(),
    entityId: transferId, permit, revision,
    payload: { lines: [{ itemId: 'item-1003', lotId: 'lot-1003', receivedQty }] },
  };
}

function legacyReceipt(command) {
  return { ...command.payload, requestId: command.commandId, receiveRevision: command.revision, offlinePermit: command.permit };
}

async function main() {
  const connectionString = disposableDatabaseUrl(process.env.DATABASE_URL);
  const password = process.env.SEED_PASSWORD;
  assert.ok(password && process.env.JWT_SECRET && process.env.ROLLBACK_API_DIR, 'Set the fixture password, JWT secret and rollback API build directory.');
  const candidate = fileURLToPath(new URL('../', import.meta.url));
  const rollback = resolve(process.env.ROLLBACK_API_DIR);
  assert.notEqual(resolve(candidate), rollback, 'Use a separately built rollback checkout.');
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    NODE_ENV: 'production', REQUIRE_DATABASE: 'true', RUN_SCHEDULERS: 'false',
    DATABASE_URL: connectionString, SEED_PASSWORD: password, JWT_SECRET: process.env.JWT_SECRET,
  };
  const database = new pg.Client({ connectionString });
  await database.connect();
  try {
    const fixture = await database.query(`SELECT status FROM "Transfer" WHERE id = $1 AND "companyId" = $2`, [transferId, companyId]);
    assert.equal(fixture.rows[0]?.status, 'DISPATCHED', 'Run migrations and seed a fresh disposable database first.');
    const before = await database.query(`SELECT count(*)::int AS receipts FROM "TransferReceipt" WHERE "transferId" = $1`, [transferId]);
    assert.equal(before.rows[0].receipts, 0, 'Start with an unused fixture.');
    const migrations = (await database.query(migrationRecords)).rows;
    assert.ok(migrations.length > 0, 'Migrate the fixture before starting either API.');

    const first = await withApi(candidate, env, async (origin) => {
      await publishReceivingPolicy(origin, password, true);
      const token = await signIn(origin, password);
      const { runtime } = await request(origin, '/api/v1/runtime/config', { token });
      assert.equal(runtime.offlineCommandVersion, 2);
      const permit = runtime.offlineWarehousePermits?.receiving?.token;
      assert.equal(typeof permit, 'string', 'the published receiving policy must issue a permit');
      const original = queuedReceipt(permit, await receivingRevision(origin, token), 5);
      const result = await request(origin, syncPath, { token, body: original });
      assert.equal(result.duplicate, false);
      assert.equal(result.receipt.receivedQty, 5);
      const pending = queuedReceipt(permit, await receivingRevision(origin, token), 3);
      console.log('Candidate applied the first command and issued the revision for pending work.');
      return { original, pending, receiptId: result.receipt.receiptId };
    });

    const rolledBack = await withApi(rollback, env, async (origin) => {
      const token = await signIn(origin, password);
      const { runtime } = await request(origin, '/api/v1/runtime/config', { token });
      assert.equal(runtime.offlineCommandVersion, undefined, 'This drill expects the permit-aware API before the shared endpoint.');
      assert.equal(typeof runtime.offlineWarehousePermits?.receiving?.token, 'string');
      const retry = await request(origin, receivePath, { token, body: legacyReceipt(first.original) });
      assert.equal(retry.duplicate, true);
      assert.equal(retry.receipt.receiptId, first.receiptId);
      const result = await request(origin, receivePath, { token, body: legacyReceipt(first.pending) });
      assert.equal(result.duplicate, false);
      assert.equal(result.receipt.receivedQty, 3);
      const revoked = queuedReceipt(first.pending.permit, await receivingRevision(origin, token), 1);
      await publishReceivingPolicy(origin, password, false);
      const rejected = await request(origin, receivePath, { token, body: legacyReceipt(revoked), status: 403 });
      assert.equal(rejected.code, 'OFFLINE_WAREHOUSE_POLICY_REJECTED');
      console.log('Rollback recovered the original receipt, applied pending work and denied a new command after revocation.');
      return { revoked, receiptId: result.receipt.receiptId };
    });

    await withApi(candidate, env, async (origin) => {
      const token = await signIn(origin, password);
      const { runtime } = await request(origin, '/api/v1/runtime/config', { token });
      assert.equal(runtime.offlineCommandVersion, 2);
      assert.equal(runtime.offlineWarehousePermits?.receiving, null);
      const replay = await request(origin, syncPath, { token, body: first.pending });
      assert.equal(replay.duplicate, true);
      assert.equal(replay.receipt.receiptId, rolledBack.receiptId);
      const rejected = await request(origin, syncPath, { token, body: rolledBack.revoked, status: 403 });
      assert.equal(rejected.code, 'OFFLINE_WAREHOUSE_POLICY_REJECTED');
    });
    const receipts = await database.query(`SELECT id FROM "TransferReceipt" WHERE "transferId" = $1 ORDER BY id`, [transferId]);
    assert.deepEqual(receipts.rows.map(({ id }) => id), [first.receiptId, rolledBack.receiptId].sort());
    const movements = await database.query(`
      SELECT count(*)::int AS movements, sum("qtyDelta")::int AS quantity
      FROM "StockMovement" WHERE "companyId" = $1 AND "sourceDocument" = $2 AND "movementType" = 'TRANSFER_IN'
    `, [companyId, transferId]);
    assert.deepEqual(movements.rows[0], { movements: 2, quantity: 8 });
    const stock = await database.query(`
      SELECT "onHand"::int AS quantity FROM "StockLedger"
      WHERE "companyId" = $1 AND "locationId" = 'loc-2' AND "itemId" = 'item-1003' AND "lotId" = 'lot-1003'
    `, [companyId]);
    assert.equal(stock.rows[0]?.quantity, 8);
    assert.deepEqual((await database.query(migrationRecords)).rows, migrations);
    console.log(`Roll-forward kept revocation active and recovered the rollback receipt. Verified 2 receipts, 2 movements, 8 units and ${migrations.length} unchanged migration records.`);
  } finally {
    await database.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
