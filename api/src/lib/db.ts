import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function isRenderRuntime(): boolean {
  return process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID);
}

/** Reads DATABASE_URL, or builds one from PG_* / DB_* parts for local/dev setups that prefer discrete env vars. */
export function resolveDatabaseUrl(): string {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) return direct;
  const host = (process.env.PGHOST || process.env.DB_HOST || '').trim();
  const user = (process.env.PGUSER || process.env.DB_USER || '').trim();
  const database = (process.env.PGDATABASE || process.env.DB_NAME || '').trim();
  if (!host || !user || !database) return '';
  const password = process.env.PGPASSWORD ?? process.env.DB_PASSWORD ?? '';
  const port = (process.env.PGPORT || process.env.DB_PORT || '5432').trim();
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

export function safeDatabaseError(error: unknown): { code: string; hint: string } {
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'DATABASE_OR_SCHEMA_NOT_READY';
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return {
      code,
      hint: 'Cannot reach the database host. Check that the Postgres instance is running and reachable from this environment.',
    };
  }
  if (code === '28P01' || code === '28000') {
    return { code, hint: 'Postgres rejected the credentials in DATABASE_URL.' };
  }
  if (code === '53300') {
    return { code, hint: 'Postgres has run out of connection slots; check max_connections and pool size.' };
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
      throw new Error('DATABASE_URL is required to read the Postgres inventory database.');
    }
    if (!/^postgres(ql)?:\/\//i.test(url)) {
      throw new Error(
        'DATABASE_URL must start with postgresql://, as in postgresql://user:password@host:5432/database.',
      );
    }
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 10) }),
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

/**
 * Postgres raw queries use $1, $2, ... positional parameters, unlike the `?`
 * placeholders MySQL used. These wrappers let call sites keep writing `?`
 * and pass values positionally, translating once here instead of at every
 * call site (lower risk than renumbering placeholders by hand throughout).
 */
function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

type RawClient = { $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>; $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number> };

export function queryRaw<T = unknown>(client: RawClient, sql: string, ...values: unknown[]): Promise<T> {
  return client.$queryRawUnsafe(toPositional(sql), ...values) as Promise<T>;
}

export function executeRaw(client: RawClient, sql: string, ...values: unknown[]): Promise<number> {
  return client.$executeRawUnsafe(toPositional(sql), ...values);
}

/** A cheap, real database round trip for readiness and admin diagnostics. */
export async function databaseProbe(): Promise<{ ok: true; latencyMs: number }> {
  const startedAt = process.hrtime.bigint();
  await prisma.$queryRawUnsafe('SELECT 1');
  return { ok: true, latencyMs: Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 10) / 10 };
}
