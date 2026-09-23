import { databaseEnabled } from './persistence.js';
import { prisma } from './db.js';

/** PostgreSQL advisory locks make timer/worker work safe across replicas. */
export async function withDistributedLock<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  if (!databaseEnabled) return work();
  const key = `invexa:${name}`;
  const acquired = await prisma.$queryRawUnsafe<Array<{ acquired: boolean }>>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', key);
  if (acquired[0]?.acquired !== true) return null;
  try {
    return await work();
  } finally {
    await prisma.$queryRawUnsafe('SELECT pg_advisory_unlock(hashtextextended($1, 0))', key).catch(() => undefined);
  }
}
