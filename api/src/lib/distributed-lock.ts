import { databaseEnabled } from './persistence.js';
import { prisma } from './db.js';

/** MySQL advisory locks make timer/worker work safe when Render runs more than one replica. */
export async function withDistributedLock<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  if (!databaseEnabled) return work();
  const key = `invexa:${name}`.slice(0, 64);
  const acquired = await prisma.$queryRawUnsafe<Array<{ acquired: number | bigint }>>('SELECT GET_LOCK(?, 0) AS acquired', key);
  if (Number(acquired[0]?.acquired ?? 0) !== 1) return null;
  try {
    return await work();
  } finally {
    await prisma.$queryRawUnsafe('SELECT RELEASE_LOCK(?)', key).catch(() => undefined);
  }
}