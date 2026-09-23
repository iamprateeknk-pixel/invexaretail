import { databaseEnabled } from './persistence.js';
import { prisma, queryRaw } from './db.js';

/** Postgres session-level advisory locks make timer/worker work safe when Render runs more than one replica. */
export async function withDistributedLock<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  if (!databaseEnabled) return work();
  const key = `invexa:${name}`.slice(0, 64);
  const acquired = await queryRaw<Array<{ acquired: boolean }>>(prisma, 'SELECT pg_try_advisory_lock(hashtext(?)::bigint) AS acquired', key);
  if (acquired[0]?.acquired !== true) return null;
  try {
    return await work();
  } finally {
    await queryRaw(prisma, 'SELECT pg_advisory_unlock(hashtext(?)::bigint)', key).catch(() => undefined);
  }
}
