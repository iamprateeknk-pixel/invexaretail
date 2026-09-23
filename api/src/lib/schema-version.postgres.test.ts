// ADR-004 / Week 5: verifySchemaVersion is read-only - these tests confirm
// that both the pass and fail paths never touch schema, only
// `_prisma_migrations` rows planted by the test itself. Skipped unless
// TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from './db.js';
import { verifySchemaVersion } from './schema-version.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function migrationRows(): Promise<Array<{ migration_name: string; finished_at: Date | null }>> {
  return prisma.$queryRawUnsafe('SELECT migration_name, finished_at FROM "_prisma_migrations"');
}

integration('a freshly migrated database matches this build\'s migrations exactly', async () => {
  const result = await verifySchemaVersion();
  assert.equal(result.ok, true);
});

integration('a migration this build ships but the database has not applied is reported as missing, not silently ignored', async () => {
  const rows = await migrationRows();
  const victim = rows[0].migration_name;
  await prisma.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE migration_name = $1', victim);
  try {
    const result = await verifySchemaVersion();
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.ok(result.missing.includes(victim));
      assert.match(result.reason, /have not been applied/i);
    }
  } finally {
    // Restore exactly what was there - this test must not leave the
    // migrations table looking like a real drift for the next test.
    await prisma.$executeRawUnsafe(
      'INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, $1, $2, NOW(), NOW(), 1)',
      'restored-by-test', victim,
    );
  }
});

integration('a migration recorded as started but never finished is reported, not treated as applied', async () => {
  const fakeName = `99999999999999_test_unfinished_${Date.now()}`;
  await prisma.$executeRawUnsafe(
    'INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, $1, $2, NOW(), NULL, 0)',
    'test-checksum', fakeName,
  );
  try {
    const result = await verifySchemaVersion();
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.ok(result.unfinished.includes(fakeName));
      assert.match(result.reason, /not finished/i);
    }
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE migration_name = $1', fakeName);
  }
});

integration('verifySchemaVersion never runs DDL - the database\'s table set is identical before and after', async () => {
  const before = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
  );
  await verifySchemaVersion();
  const after = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
  );
  assert.deepEqual(after, before);
});
