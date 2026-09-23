"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const pg_1 = require("pg");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
integration('Postgres: migrations, rollback, cross-connection advisory lock and idempotency retry', async () => {
    const first = new pg_1.Client({ connectionString: databaseUrl });
    const second = new pg_1.Client({ connectionString: databaseUrl });
    const pool = new pg_1.Pool({ connectionString: databaseUrl, max: 8 });
    await first.connect();
    await second.connect();
    try {
        const outbox = await first.query('SELECT to_regclass($1) AS reg', ['"DomainEventOutbox"']);
        strict_1.default.ok(outbox.rows[0].reg, 'durable outbox migration must be present');
        await first.query('CREATE TABLE IF NOT EXISTS "CiIdempotencyProbe" (id BIGSERIAL PRIMARY KEY, "requestKey" VARCHAR(191) NOT NULL UNIQUE, value INT NOT NULL)');
        await first.query('BEGIN');
        await first.query('INSERT INTO "CiIdempotencyProbe" ("requestKey", value) VALUES ($1, $2)', ['rollback-check', 1]);
        await first.query('ROLLBACK');
        const rolledBack = await first.query('SELECT COUNT(*) AS count FROM "CiIdempotencyProbe" WHERE "requestKey" = $1', ['rollback-check']);
        strict_1.default.equal(Number(rolledBack.rows[0].count), 0);
        const lock = await first.query('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired', ['invexa-ci-lock']);
        strict_1.default.equal(lock.rows[0].acquired, true);
        const contended = await second.query('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired', ['invexa-ci-lock']);
        strict_1.default.equal(contended.rows[0].acquired, false, 'only one worker may own the lock');
        await first.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', ['invexa-ci-lock']);
        await Promise.all(Array.from({ length: 8 }, () => pool.query('INSERT INTO "CiIdempotencyProbe" ("requestKey", value) VALUES ($1, $2) ON CONFLICT ("requestKey") DO NOTHING', ['retry-key', 7])));
        const deduped = await first.query('SELECT COUNT(*) AS count FROM "CiIdempotencyProbe" WHERE "requestKey" = $1', ['retry-key']);
        strict_1.default.equal(Number(deduped.rows[0].count), 1, 'replayed request posts only once');
    }
    finally {
        await first.query('DROP TABLE IF EXISTS "CiIdempotencyProbe"').catch(() => undefined);
        await first.end();
        await second.end();
        await pool.end();
    }
});
