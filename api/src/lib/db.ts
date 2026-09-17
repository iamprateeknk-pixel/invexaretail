import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const HOSTINGER_PRIVATE_HOSTS = new Set([
  ...LOOPBACK_HOSTS,
  'srv834.hstgr.io',
]);

export function isRenderRuntime(): boolean {
  return process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID);
}

export function publicMysqlHost(): string {
  return (process.env.MYSQL_PUBLIC_HOST || '82.25.121.149').trim();
}

function rewriteUnreachableMysqlHost(url: string): string {
  if (!isRenderRuntime()) return url;
  return url.replace(/@(localhost|127\.0\.0\.1|::1|srv834\.hstgr\.io)(?=[:/])/i, `@${publicMysqlHost()}`);
}

function urlFromParts(): string {
  const host = (process.env.MYSQL_HOST || process.env.DB_HOST || '').trim();
  const user = (process.env.MYSQL_USER || process.env.DB_USER || '').trim();
  const database = (process.env.MYSQL_DATABASE || process.env.DB_NAME || '').trim();
  if (!host || !user || !database) return '';
  const password = process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? '';
  const port = (process.env.MYSQL_PORT || process.env.DB_PORT || '3306').trim();
  const resolvedHost = isRenderRuntime() && HOSTINGER_PRIVATE_HOSTS.has(host.toLowerCase()) ? publicMysqlHost() : host;
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${resolvedHost}:${port}/${encodeURIComponent(database)}`;
}

/**
 * Hostinger phpMyAdmin shows Server 127.0.0.1. That only works on the
 * Hostinger machine. Render copied the same DATABASE_URL would otherwise
 * point at Render itself. Rewrite loopback to the public MariaDB host.
 */
export function resolveDatabaseUrl(): string {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) return rewriteUnreachableMysqlHost(direct);
  return urlFromParts();
}

export function parseMysqlUrl(url: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
  if (!parsed.hostname || !parsed.username || !database) {
    throw new Error('DATABASE_URL must include host, user and database.');
  }
  return {
    host: decodeURIComponent(parsed.hostname),
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

export function mysqlPoolConfig(url: string) {
  const parsed = parseMysqlUrl(url);
  const connectionLimit = Math.max(1, Number(process.env.MYSQL_CONNECTION_LIMIT || 2));
  return {
    ...parsed,
    connectionLimit,
    minimumIdle: 1,
    acquireTimeout: 8_000,
    connectTimeout: 8_000,
    idleTimeout: 0,
    resetAfterUse: false,
  };
}

export function safeDatabaseError(error: unknown): { code: string; hint: string } {
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'DATABASE_OR_SCHEMA_NOT_READY';
  if (code === 'ER_USER_LIMIT_REACHED') {
    return {
      code,
      hint: 'Hostinger MySQL hourly connection limit was reached (500/hour on this shared user). Wait until the hour resets, then sign in again. Invexa now keeps a 2-connection pool so this does not trip as easily.',
    };
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return {
      code,
      hint: 'Cannot reach the database host. On Render use IP 82.25.121.149, and keep Hostinger Remote MySQL set to %.',
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
      throw new Error('DATABASE_URL is required to read the Hostinger MySQL inventory.');
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      throw new Error(
        'DATABASE_URL must start with a scheme, as in mysql://user:password@host:3306/database.',
      );
    }
    client = new PrismaClient({
      adapter: new PrismaMariaDb(mysqlPoolConfig(url)),
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
