import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function urlFromParts(): string {
  const host = (process.env.PGHOST || process.env.DB_HOST || '').trim();
  const user = (process.env.PGUSER || process.env.DB_USER || '').trim();
  const database = (process.env.PGDATABASE || process.env.DB_NAME || '').trim();
  if (!host || !user || !database) return '';
  const password = process.env.PGPASSWORD ?? process.env.DB_PASSWORD ?? '';
  const port = (process.env.PGPORT || process.env.DB_PORT || '5432').trim();
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

export function resolveDatabaseUrl(): string {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) return direct;
  return urlFromParts();
}

export function validatePostgresUrl(url: string): string {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use postgresql:// (or postgres://).');
  }
  if (!parsed.hostname || !parsed.username || !parsed.pathname.replace(/^\/+/, '')) {
    throw new Error('DATABASE_URL must include host, user and database.');
  }
  return url;
}

export function safeDatabaseError(error: unknown): { code: string; hint: string } {
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'DATABASE_OR_SCHEMA_NOT_READY';
  if (code === '53300') {
    return {
      code,
      hint: 'PostgreSQL has no connection slots available. Check the service pool size and active connections.',
    };
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return {
      code,
      hint: 'Cannot reach PostgreSQL. Check the Render database status and DATABASE_URL.',
    };
  }
  return {
    code,
    hint: 'Cannot reach the database. Check DATABASE_URL (a "@" in the password must be written as %40).',
  };
}

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) {
    const url = resolveDatabaseUrl();
    if (!url) {
      throw new Error('DATABASE_URL is required to use durable PostgreSQL storage.');
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      throw new Error(
        'DATABASE_URL must start with postgresql:// (or postgres://).',
      );
    }
    validatePostgresUrl(url);
    client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        max: Math.max(1, Number(process.env.PG_POOL_MAX || 5)),
        connectionTimeoutMillis: 8_000,
        idleTimeoutMillis: 30_000,
      }),
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return client;
}

// persistence.ts imports this module unconditionally, so building the client
// at import time would crash the in-memory mode before it can start.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const active = getClient();
    const value = Reflect.get(active, prop, active);
    return typeof value === 'function' ? value.bind(active) : value;
  },
});

/** A cheap, real database round trip for readiness and admin diagnostics. */
export async function databaseProbe(): Promise<{ ok: true; latencyMs: number }> {
  const startedAt = process.hrtime.bigint();
  await prisma.$queryRawUnsafe('SELECT 1');
  return { ok: true, latencyMs: Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 10) / 10 };
}
