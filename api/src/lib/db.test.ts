import test from 'node:test';
import assert from 'node:assert/strict';

import { mysqlPoolConfig, parseMysqlUrl, publicMysqlHost, resolveDatabaseUrl, safeDatabaseError } from './db.js';

const URL_ENV = ['DATABASE_URL', 'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const;

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

test('Render rewrites Hostinger phpMyAdmin loopback to the public MariaDB host', () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousRender = process.env.RENDER;
  process.env.RENDER = 'true';
  process.env.DATABASE_URL = 'mysql://u411689398_invexa:p%40ss@127.0.0.1:3306/u411689398_invexa';
  assert.equal(
    resolveDatabaseUrl(),
    `mysql://u411689398_invexa:p%40ss@${publicMysqlHost()}:3306/u411689398_invexa`,
  );
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  if (previousRender === undefined) delete process.env.RENDER;
  else process.env.RENDER = previousRender;
});

test('Render rewrites the Hostinger hostname that times out from public clouds', () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousRender = process.env.RENDER;
  process.env.RENDER = 'true';
  process.env.DATABASE_URL = 'mysql://u411689398_invexauser:p%40ss@srv834.hstgr.io:3306/u411689398_invexa';
  assert.equal(
    resolveDatabaseUrl(),
    `mysql://u411689398_invexauser:p%40ss@${publicMysqlHost()}:3306/u411689398_invexa`,
  );
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  if (previousRender === undefined) delete process.env.RENDER;
  else process.env.RENDER = previousRender;
});

test('mysql pool stays tiny so Hostinger hourly connection limits are not burned', () => {
  const pool = mysqlPoolConfig('mysql://u411689398_invexauser:p%40ss@82.25.121.149:3306/u411689398_invexa');
  assert.equal(pool.host, '82.25.121.149');
  assert.equal(pool.user, 'u411689398_invexauser');
  assert.equal(pool.password, 'p@ss');
  assert.equal(pool.database, 'u411689398_invexa');
  assert.equal(pool.connectionLimit, 2);
  assert.equal(pool.idleTimeout, 0);
  assert.deepEqual(parseMysqlUrl('mysql://shop:p%40ss@127.0.0.1:3306/invexa'), {
    host: '127.0.0.1',
    port: 3306,
    user: 'shop',
    password: 'p@ss',
    database: 'invexa',
  });
});

test('ready hint names the Hostinger hourly connection cap', () => {
  assert.equal(safeDatabaseError({ code: 'ER_USER_LIMIT_REACHED' }).code, 'ER_USER_LIMIT_REACHED');
  assert.match(safeDatabaseError({ code: 'ER_USER_LIMIT_REACHED' }).hint, /hourly connection limit/);
});

test('Hostinger keeps 127.0.0.1 so the local phpMyAdmin database is used', () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousRender = process.env.RENDER;
  const previousService = process.env.RENDER_SERVICE_ID;
  delete process.env.RENDER;
  delete process.env.RENDER_SERVICE_ID;
  process.env.DATABASE_URL = 'mysql://shop:secret@127.0.0.1:3306/u411689398_invexa';
  assert.equal(resolveDatabaseUrl(), 'mysql://shop:secret@127.0.0.1:3306/u411689398_invexa');
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  if (previousRender === undefined) delete process.env.RENDER;
  else process.env.RENDER = previousRender;
  if (previousService === undefined) delete process.env.RENDER_SERVICE_ID;
  else process.env.RENDER_SERVICE_ID = previousService;
});
