import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDatabaseUrl, safeDatabaseError } from './db.js';

const URL_ENV = ['DATABASE_URL', 'PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT'] as const;

function withCleanDbEnv(run: () => void) {
  const previous = Object.fromEntries(URL_ENV.map((key) => [key, process.env[key]]));
  for (const key of URL_ENV) delete process.env[key];
  try {
    run();
  } finally {
    for (const key of URL_ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('resolveDatabaseUrl is empty without connection settings', () => {
  withCleanDbEnv(() => {
    assert.equal(resolveDatabaseUrl(), '');
  });
});

test('resolveDatabaseUrl passes DATABASE_URL through unchanged', () => {
  withCleanDbEnv(() => {
    process.env.DATABASE_URL = 'postgresql://shop:p%40ss@127.0.0.1:5432/invexa';
    assert.equal(resolveDatabaseUrl(), 'postgresql://shop:p%40ss@127.0.0.1:5432/invexa');
  });
});

test('resolveDatabaseUrl builds a URL from discrete PG_* parts', () => {
  withCleanDbEnv(() => {
    process.env.PGHOST = '127.0.0.1';
    process.env.PGUSER = 'shop';
    process.env.PGPASSWORD = 'p@ss';
    process.env.PGDATABASE = 'invexa';
    assert.equal(resolveDatabaseUrl(), 'postgresql://shop:p%40ss@127.0.0.1:5432/invexa');
  });
});

test('safeDatabaseError names unreachable hosts and bad credentials', () => {
  assert.match(safeDatabaseError({ code: 'ECONNREFUSED' }).hint, /reachable/);
  assert.match(safeDatabaseError({ code: '28P01' }).hint, /credentials/);
});
