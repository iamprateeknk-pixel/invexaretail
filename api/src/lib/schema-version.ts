// ADR-004 / Week 5: startup verifies schema version, it never mutates it.
// Runtime DDL (CREATE/ALTER TABLE at boot) was retired in Week 2 - this is
// its replacement: a read-only check that the database's applied migration
// history matches what this build ships, failing closed with a clear
// message through /ready when it does not, rather than either (a) silently
// serving traffic against a schema the code does not match, or (b) trying
// to fix it itself.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from './db.js';

type MigrationRow = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };

function migrationsOnDisk(): string[] {
  const dir = join(process.cwd(), 'prisma', 'migrations');
  try {
    return readdirSync(dir)
      .filter((name) => name !== 'migration_lock.toml')
      .filter((name) => statSync(join(dir, name)).isDirectory())
      .sort();
  } catch {
    // No migrations directory shipped with this build - nothing to compare
    // against, so this check has nothing to say. db:migrate/db:verify (run
    // in the deploy pipeline, not here) are the real gate in that case.
    return [];
  }
}

export type SchemaVersionResult =
  | { ok: true; appliedCount: number }
  | { ok: false; reason: string; missing: string[]; unfinished: string[] };

/** Read-only: queries `_prisma_migrations`, never writes to it or anything else. */
export async function verifySchemaVersion(): Promise<SchemaVersionResult> {
  const onDisk = migrationsOnDisk();
  if (onDisk.length === 0) return { ok: true, appliedCount: 0 };

  const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
    'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"',
  );
  const applied = new Map(rows.map((row) => [row.migration_name, row]));

  const missing = onDisk.filter((name) => !applied.has(name));
  const unfinished = rows
    .filter((row) => !row.finished_at && !row.rolled_back_at)
    .map((row) => row.migration_name);

  if (missing.length || unfinished.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`${missing.length} migration(s) this build ships have not been applied to this database (${missing.join(', ')})`);
    if (unfinished.length) parts.push(`${unfinished.length} migration(s) are recorded as started but not finished (${unfinished.join(', ')}) - a previous migrate deploy may have failed partway`);
    return {
      ok: false,
      reason: `Database schema is out of date. ${parts.join('; ')}. Run "npm run db:migrate" against this database, then restart. This check never runs DDL itself.`,
      missing,
      unfinished,
    };
  }

  return { ok: true, appliedCount: onDisk.length };
}
