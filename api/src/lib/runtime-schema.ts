import { prisma } from './db.js';

let schemaPromise: Promise<void> | undefined;

/**
 * Verify that the migration-managed PostgreSQL schema is reachable.
 * Application startup never creates or mutates tables at runtime.
 */
export function ensureRuntimeSchema(): Promise<void> {
  schemaPromise ??= prisma.$queryRaw`SELECT 1`
    .then(() => undefined)
    .catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  return schemaPromise;
}

export const ensureDailySyncSchema = ensureRuntimeSchema;
