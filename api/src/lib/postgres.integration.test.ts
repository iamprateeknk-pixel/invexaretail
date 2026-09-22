import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, Pool } from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('Postgres: migrations, rollback, cross-connection advisory lock and idempotency retry', async () => {
  const first = new Client({ connectionString: databaseUrl });
  const second = new Client({ connectionString: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  await first.connect();
  await second.connect();
  try {
    const outbox = await first.query('SELECT to_regclass($1) AS reg', ['"DomainEventOutbox"']);
    assert.ok(outbox.rows[0].reg, 'durable outbox migration must be present');
    await first.query('CREATE TABLE IF NOT EXISTS "CiIdempotencyProbe" (id BIGSERIAL PRIMARY KEY, "requestKey" VARCHAR(191) NOT NULL UNIQUE, value INT NOT NULL)');
    await first.query('BEGIN');
    await first.query('INSERT INTO "CiIdempotencyProbe" ("requestKey", value) VALUES ($1, $2)', ['rollback-check', 1]);
    await first.query('ROLLBACK');
    const rolledBack = await first.query('SELECT COUNT(*) AS count FROM "CiIdempotencyProbe" WHERE "requestKey" = $1', ['rollback-check']);
    assert.equal(Number(rolledBack.rows[0].count), 0);

    const lock = await first.query('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired', ['invexa-ci-lock']);
    assert.equal(lock.rows[0].acquired, true);
    const contended = await second.query('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired', ['invexa-ci-lock']);
    assert.equal(contended.rows[0].acquired, false, 'only one worker may own the lock');
    await first.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', ['invexa-ci-lock']);

    await Promise.all(Array.from({ length: 8 }, () =>
      pool.query('INSERT INTO "CiIdempotencyProbe" ("requestKey", value) VALUES ($1, $2) ON CONFLICT ("requestKey") DO NOTHING', ['retry-key', 7]),
    ));
    const deduped = await first.query('SELECT COUNT(*) AS count FROM "CiIdempotencyProbe" WHERE "requestKey" = $1', ['retry-key']);
    assert.equal(Number(deduped.rows[0].count), 1, 'replayed request posts only once');
  } finally {
    await first.query('DROP TABLE IF EXISTS "CiIdempotencyProbe"').catch(() => undefined);
    await first.end();
    await second.end();
    await pool.end();
  }
});
