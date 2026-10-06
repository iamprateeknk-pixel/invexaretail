#!/usr/bin/env node
// Plan Area J WP3 (migration/restore matrix): test the database like a production upgrade.
//
//   fresh    empty database -> every migration -> schema matches schema.prisma (no drift)
//   upgrade  a database as a PREVIOUS release left it (all but the newest N migrations, with
//            data in it) -> migrate deploy applies the rest -> the data survives, no drift
//   restore  (only with --docker <container>) dump a migrated, populated database, restore it
//            into an empty one, and prove row counts, migration history and drift are intact
//
//   node scripts/migration-matrix.mjs --admin-url postgresql://user:pass@host:5432/postgres \
//        [--behind 3] [--docker <postgres-container> --docker-user ci] [--keep]
//
// Exit code 1 if any case fails. Databases are created fresh (matrix_*) and dropped at the end
// unless --keep. The admin URL needs CREATE DATABASE rights.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'prisma', 'migrations');

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const adminUrl = flag('admin-url', process.env.MATRIX_ADMIN_URL);
const behind = Number(flag('behind', '3'));
const dockerContainer = flag('docker');
const dockerUser = flag('docker-user', 'ci');
const keep = args.includes('--keep');

export function migrationNames(dir = migrationsDir) {
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function withDatabase(adminConnection, name) {
  const url = new URL(adminConnection);
  url.pathname = `/${name}`;
  return url.toString();
}

function prisma(args, databaseUrl, { allowFail = false } = {}) {
  const run = spawnSync('npx', ['prisma', ...args], { cwd: root, shell: true, encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl } });
  if (run.status !== 0 && !allowFail) throw new Error(`prisma ${args.join(' ')} failed:\n${run.stdout}\n${run.stderr}`);
  return run;
}

async function admin(sql) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try { return await client.query(sql); } finally { await client.end(); }
}

async function query(databaseUrl, sql, params = []) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try { return await client.query(sql, params); } finally { await client.end(); }
}

async function rowCounts(databaseUrl) {
  const tables = await query(databaseUrl, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename");
  const counts = {};
  for (const { tablename } of tables.rows) {
    counts[tablename] = Number((await query(databaseUrl, `SELECT COUNT(*) AS n FROM "${tablename}"`)).rows[0].n);
  }
  return counts;
}

function assertNoDrift(databaseUrl, label) {
  const run = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], databaseUrl, { allowFail: true });
  if (run.status !== 0) throw new Error(`${label}: schema drift between the migrated database and schema.prisma:\n${run.stdout}${run.stderr}`);
}

async function assertAllMigrationsRecorded(databaseUrl, label) {
  const expected = migrationNames();
  const rows = (await query(databaseUrl, 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows.map((r) => r.migration_name);
  const missing = expected.filter((name) => !rows.includes(name));
  if (missing.length) throw new Error(`${label}: migrations not recorded as applied: ${missing.join(', ')}`);
}

// Data as a previous release would have held it: only tables that already existed then and only
// columns every later migration kept (later migrations add defaulted columns).
async function seedLegacyData(databaseUrl) {
  await query(databaseUrl, `INSERT INTO "CompanyProfile"(id, name, "updatedAt") VALUES ('mx-co', 'Matrix Co', now())`);
  await query(databaseUrl, `INSERT INTO "Location"(id, code, name, type, "companyId", "updatedAt") VALUES ('mx-loc', 'MXL', 'Matrix Loc', 'warehouse', 'mx-co', now())`);
  for (let i = 1; i <= 25; i += 1) {
    await query(databaseUrl, `INSERT INTO "Item"(id, code, name, "companyId", "updatedAt") VALUES ($1, $2, $3, 'mx-co', now())`, [`mx-item-${i}`, `MX${i}`, `Matrix item ${i}`]);
    await query(databaseUrl, `INSERT INTO "Lot"(id, "lotNo", "itemId", "updatedAt") VALUES ($1, $2, $3, now())`, [`mx-lot-${i}`, `L${i}`, `mx-item-${i}`]);
    await query(databaseUrl, `INSERT INTO "StockLedger"(id, "itemId", "lotId", "locationId", "onHand", "companyId", "lastUpdatedAt") VALUES ($1, $2, $3, 'mx-loc', $4, 'mx-co', now())`, [`mx-sl-${i}`, `mx-item-${i}`, `mx-lot-${i}`, i * 3]);
  }
}

const results = [];
async function runCase(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, seconds: ((Date.now() - started) / 1000).toFixed(1), detail });
  } catch (error) {
    results.push({ name, ok: false, seconds: ((Date.now() - started) / 1000).toFixed(1), detail: error instanceof Error ? error.message : String(error) });
  }
}

async function recreate(name) {
  await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin(`CREATE DATABASE "${name}"`);
  return withDatabase(adminUrl, name);
}

async function main() {
  if (!adminUrl) throw new Error('Pass --admin-url (or MATRIX_ADMIN_URL): a connection that can CREATE DATABASE.');
  const all = migrationNames();
  const created = [];

  await runCase('fresh: empty database -> all migrations', async () => {
    const url = await recreate('matrix_fresh'); created.push('matrix_fresh');
    prisma(['migrate', 'deploy'], url);
    await assertAllMigrationsRecorded(url, 'fresh');
    assertNoDrift(url, 'fresh');
    return `${all.length} migrations applied, no drift`;
  });

  await runCase(`upgrade: previous release (${behind} migrations behind, with data) -> latest`, async () => {
    if (behind < 1 || behind >= all.length) throw new Error('--behind must be between 1 and the migration count - 1.');
    const url = await recreate('matrix_upgrade'); created.push('matrix_upgrade');
    const older = all.slice(0, all.length - behind);
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      for (const name of older) await client.query(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'));
    } finally { await client.end(); }
    // record them as applied exactly as a real previous deploy would have
    prisma(['migrate', 'resolve', '--applied', older[0]], url, { allowFail: true }); // creates _prisma_migrations
    for (const name of older.slice(1)) prisma(['migrate', 'resolve', '--applied', name], url);
    await seedLegacyData(url);
    const before = await rowCounts(url);
    prisma(['migrate', 'deploy'], url);
    await assertAllMigrationsRecorded(url, 'upgrade');
    assertNoDrift(url, 'upgrade');
    const after = await rowCounts(url);
    for (const table of ['CompanyProfile', 'Location', 'Item', 'Lot', 'StockLedger']) {
      if (after[table] !== before[table]) throw new Error(`upgrade changed ${table}: ${before[table]} -> ${after[table]}`);
    }
    return `${behind} migrations applied over live data; ${before.Item} items and ${before.StockLedger} ledger rows intact, no drift`;
  });

  if (dockerContainer) {
    await runCase(`restore: dump -> restore into an empty database (container ${dockerContainer})`, async () => {
      const source = await recreate('matrix_restore_src'); created.push('matrix_restore_src');
      prisma(['migrate', 'deploy'], source);
      await seedLegacyData(source);
      const target = await recreate('matrix_restore_dst'); created.push('matrix_restore_dst');
      const sh = (cmd) => {
        const run = spawnSync('docker', ['exec', dockerContainer, 'sh', '-c', cmd], { encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`${cmd}\n${run.stdout}${run.stderr}`);
      };
      sh(`pg_dump -U ${dockerUser} -Fc matrix_restore_src -f /var/tmp/matrix.dump`);
      sh(`pg_restore -U ${dockerUser} -d matrix_restore_dst --no-owner /var/tmp/matrix.dump`);
      sh('rm -f /var/tmp/matrix.dump');
      const [a, b] = [await rowCounts(source), await rowCounts(target)];
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`row counts differ after restore:\n${JSON.stringify(a)}\n${JSON.stringify(b)}`);
      await assertAllMigrationsRecorded(target, 'restore');
      assertNoDrift(target, 'restore');
      prisma(['migrate', 'deploy'], target); // a restored database must accept the next release as well
      const total = Object.values(b).reduce((sum, n) => sum + n, 0);
      return `${Object.keys(b).length} tables and ${total} rows identical; migration history intact; no drift; next deploy is a no-op`;
    });
  }

  if (!keep) for (const name of created) await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);

  console.log('\nMigration matrix');
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  (${result.seconds}s)\n      ${result.detail.split('\n').join('\n      ')}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/migration-matrix.mjs')) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
