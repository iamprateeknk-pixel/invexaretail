"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const pg_1 = __importDefault(require("pg"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
integration('PostgreSQL: migrations, rollback, cross-connection lock and idempotency retry', async () => {
    const pool = new pg_1.default.Pool({ connectionString: databaseUrl, max: 4 });
    const first = await pool.connect();
    const second = await pool.connect();
    try {
        const outbox = await first.query("SELECT to_regclass('public.\"DomainEventOutbox\"') AS table_name");
        strict_1.default.equal(outbox.rows[0]?.table_name, '"DomainEventOutbox"', 'durable outbox migration must be present');
        await first.query('CREATE TABLE IF NOT EXISTS "CiIdempotencyProbe" ("id" BIGSERIAL PRIMARY KEY, "requestKey" VARCHAR(191) NOT NULL UNIQUE, "value" INTEGER NOT NULL)');
        await first.query('BEGIN');
        await first.query('INSERT INTO "CiIdempotencyProbe" ("requestKey","value") VALUES ($1,$2)', ['rollback-check', 1]);
        await first.query('ROLLBACK');
        const rolledBack = await first.query('SELECT COUNT(*)::int AS count FROM "CiIdempotencyProbe" WHERE "requestKey" = $1', ['rollback-check']);
        strict_1.default.equal(rolledBack.rows[0].count, 0);
        const lock = await first.query("SELECT pg_try_advisory_lock(hashtext('invexa-ci-lock')) AS acquired");
        strict_1.default.equal(lock.rows[0].acquired, true);
        const contended = await second.query("SELECT pg_try_advisory_lock(hashtext('invexa-ci-lock')) AS acquired");
        strict_1.default.equal(contended.rows[0].acquired, false, 'only one worker may own the lock');
        await first.query("SELECT pg_advisory_unlock(hashtext('invexa-ci-lock'))");
        await Promise.all(Array.from({ length: 8 }, () => second.query('INSERT INTO "CiIdempotencyProbe" ("requestKey","value") VALUES ($1,$2) ON CONFLICT ("requestKey") DO NOTHING', ['retry-key', 7])));
        const deduped = await first.query('SELECT COUNT(*)::int AS count FROM "CiIdempotencyProbe" WHERE "requestKey" = $1', ['retry-key']);
        strict_1.default.equal(deduped.rows[0].count, 1, 'replayed request posts only once');
    }
    finally {
        first.release();
        second.release();
        await pool.end();
    }
});
