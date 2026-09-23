import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDatabaseUrl, safeDatabaseError, validatePostgresUrl } from './db.js';

const URL_ENV = ['DATABASE_URL', 'PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT'] as const;

function withCleanDbEnv(run: () => void) {
  const previous = Object.fromEntries(URL_ENV.map((key) => [key, process.env[key]]));
  for (const key of URL_ENV) delete process.env[key];
  try { run(); } finally {
    for (const key of URL_ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('resolveDatabaseUrl is empty without connection settings', () => {
  withCleanDbEnv(() => assert.equal(resolveDatabaseUrl(), ''));
});

test('resolveDatabaseUrl accepts Render-style PostgreSQL URL', () => {
  withCleanDbEnv(() => {
    process.env.DATABASE_URL = 'postgresql://invexa:p%40ss@db.internal:5432/invexa';
    assert.equal(resolveDatabaseUrl(), process.env.DATABASE_URL);
    assert.equal(validatePostgresUrl(resolveDatabaseUrl()), process.env.DATABASE_URL);
  });
});

test('resolveDatabaseUrl composes standard PostgreSQL environment variables', () => {
  withCleanDbEnv(() => {
    process.env.PGHOST = 'localhost';
    process.env.PGUSER = 'shop';
    process.env.PGPASSWORD = 'p@ss';
    process.env.PGDATABASE = 'invexa';
    assert.equal(resolveDatabaseUrl(), 'postgresql://shop:p%40ss@localhost:5432/invexa');
  });
});

test('validatePostgresUrl rejects non-PostgreSQL URLs', () => {
  assert.throws(() => validatePostgresUrl('http://user:pass@host/database'), /postgresql/);
});

test('ready hint explains PostgreSQL connection exhaustion', () => {
  const result = safeDatabaseError({ code: '53300' });
  assert.equal(result.code, '53300');
  assert.match(result.hint, /connection slots/);
});
