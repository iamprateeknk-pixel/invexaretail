import { Client } from 'pg';
import { databaseEnabled } from './persistence.js';
import { resolveDatabaseUrl } from './db.js';

/**
 * Postgres session-level advisory locks make timer/worker work safe when more
 * than one replica runs. A session lock belongs to ONE database connection,
 * so the lock is taken on a dedicated pg client that stays pinned for the
 * whole critical section. Routing lock/unlock through the pooled Prisma
 * client could land them on different sessions: the unlock then silently
 * no-ops and the lock leaks until that pooled connection happens to die.
 */
export async function withDistributedLock<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  if (!databaseEnabled) return work();
  const key = `invexa:${name}`.slice(0, 64);
  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired', [key]);
    if (rows[0]?.acquired !== true) return null;
    try {
      return await work();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [key]).catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
