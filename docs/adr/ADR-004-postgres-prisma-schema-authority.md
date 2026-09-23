# ADR-004: Postgres is the database; Prisma migrations are the only way schema changes; startup only verifies schema version

## Context
The API ran on MySQL/MariaDB (`mysql2`, `@prisma/adapter-mariadb`,
Hostinger shared hosting as the deployed target). Because Hostinger shared
hosting exposed no reliable release/migration hook, the codebase grew a
parallel schema-management path: `lib/foundation-schema.ts` (419 lines) and
`lib/runtime-schema.ts` (646 lines) hand-ran `CREATE TABLE IF NOT EXISTS` /
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` MySQL DDL on every API boot,
duplicating - and risking drift from - the same tables already declared in
`prisma/schema.prisma`. This is exactly the "runtime DDL" pattern this
document's AGENTS.md now prohibits.

## Decision
1. The database is Postgres. `prisma/schema.prisma`'s datasource provider is
   `postgresql`; the driver adapter is `@prisma/adapter-pg` (`pg`), replacing
   `@prisma/adapter-mariadb` (`mysql2`).
2. Schema changes happen exclusively through `prisma migrate deploy`
   (`render.yaml`'s `preDeployCommand`, `docker-compose`'s `api` container
   entrypoint via `prisma db push` for local/dev). The 55 MySQL-dialect
   migrations under `api/prisma/migrations_mysql_archive/` are retired (kept
   for history, not replayed) and replaced with one fresh Postgres baseline
   (`20260922123350_init_postgres`) generated from the current schema.
3. `ensureFoundationSchema()` and `ensureDailySyncSchema()` are now no-ops.
   Every table they used to hand-create is already a Prisma model (verified:
   all but three - `DomainEventOutbox`, `TransferEvidence`, `ItemPhoto` -
   already existed in `schema.prisma`; those three were added as real Prisma
   models in this change, closing the last MySQL-workaround gap).
4. Startup verifies schema version, it does not change it: `scripts/verify-production-db.cjs`
   (`npm run db:verify`, run by `render.yaml`'s deploy pipeline after
   `db:migrate`) checks that `_prisma_migrations` exists and the database
   answers a basic health query. It never runs DDL - the boot path is
   read-only with respect to schema, matching "startup only verifies schema
   version" rather than "startup can also fix schema version" (which is
   exactly the runtime-DDL pattern this ADR retires).
5. Raw SQL that cannot be expressed as a Prisma Client call (row locks via
   `FOR UPDATE`, the multi-row `StockLedger` upsert on receipt, the
   `pg_try_advisory_lock` worker/timer lock, the bulk `UPDATE ... FROM
   (VALUES ...)` import reversal) keeps using `$queryRaw`/`$executeRaw`, but
   with Postgres syntax (double-quoted exact-case identifiers, `$n`
   placeholders via a `queryRaw`/`executeRaw` translation helper in
   `lib/db.ts`, `ON CONFLICT ... DO UPDATE` instead of `ON DUPLICATE KEY
   UPDATE`) - this raw-SQL surface is the tracked exception to "no runtime
   DDL", not DDL itself, and stays reviewable per file.

## Alternatives considered
- **Keep the MySQL runtime-DDL self-heal, just make it Postgres-syntax.**
  Rejected: it would mean maintaining ~250 hand-written `ALTER`/`CREATE`
  statements in parallel with `schema.prisma` forever, for a problem
  (Hostinger's missing migration hook) that no longer exists once deploys run
  `prisma migrate deploy`. Every one of those statements was already
  redundant with an existing Prisma model.
- **`prisma db push` in production instead of `migrate deploy`.** Rejected
  for the deployed target (no migration history, no safe rollback path);
  kept only for the disposable local/dev `docker-compose` container, which
  already discards its migration folder on every start.

## Migration impact
- `DATABASE_URL` must be a `postgresql://` URL everywhere (Render env var,
  `docker-compose.yml`, `.env.example`). MySQL data does not migrate
  automatically - this is a fresh Postgres database, not an in-place
  conversion; any existing MySQL production data needs a one-time export/
  import pass before cutover (out of scope for this ADR; track as a
  follow-up runbook before the real production cutover).
- `package.json`: `mysql2` and `@prisma/adapter-mariadb` removed; `pg` and
  `@prisma/adapter-pg` added.
- Three new Prisma models (`TransferEvidence`, `ItemPhoto`,
  `DomainEventOutbox`) replace hand-written raw-SQL tables of the same
  shape; `lib/transfer-evidence.ts`, `lib/item-photos.ts` and
  `lib/event-bus.ts` now use Prisma Client instead of raw SQL for these.

## Compatibility
No API response shape changes. `GET_LOCK`/`RELEASE_LOCK` (MySQL) became
`pg_try_advisory_lock`/`pg_advisory_unlock` with a `hashtext()`-derived key,
same semantics (session-scoped, non-blocking, one lock per logical name).

## Rollback
Revert this ADR's commit; re-point `DATABASE_URL` at a MySQL instance and
redeploy the previous commit's `api/` build, which still ships the
MySQL-dialect migrations under version control (moved, not deleted, to
`prisma/migrations_mysql_archive/`).

## Week 5 addendum: schema drift report and startup verification

Week 5 asked for the drift report and runtime-DDL retirement plan this ADR
already implied but had not produced evidence for, plus the one piece
genuinely missing: startup verifying schema version instead of the retired
runtime DDL doing so implicitly by running it. Delivered:

- `docs/schema-drift-report.md`: a clean `prisma migrate deploy` build and a
  restored-staging copy (older schema + real seeded data, upgraded through
  the same migration path) both converge to zero drift against
  `schema.prisma` - commands and output captured verbatim, not just claimed.
- `lib/schema-version.ts`'s `verifySchemaVersion()`: a read-only check
  (one `SELECT` against `_prisma_migrations`) wired into `GET /ready`,
  returning `503 SCHEMA_VERSION_MISMATCH` with a specific, actionable
  message if the database's applied migrations don't exactly match what
  this build ships - "startup may verify and fail with a clear message but
  must not mutate schema," per the guide. Its own test suite
  (`lib/schema-version.postgres.test.ts`) asserts the database's table set
  is byte-identical before and after calling it.
- `docs/decimal-migration-plan.md`: the Float -> Decimal dictionary (all 80
  Float fields in `schema.prisma`, categorized and assigned a precision/
  scale/rounding policy) plus an *executed* rehearsal against a disposable
  Postgres copy - real before/after checksums, a genuinely-flagged exception
  row, and the reconciliation math, not a hypothetical plan. `schema.prisma`
  itself is unchanged this week - the guide is explicit that this week
  prepares the conversion "without changing stock truth yet."

## Consequences (measurable)
- Runtime DDL surface: ~250 hand-written `ALTER`/`CREATE` statements across
  `foundation-schema.ts` + `runtime-schema.ts` -> 0 (both files are now
  effectively no-ops kept for call-site compatibility).
- Validated locally end-to-end against a real Postgres 16 instance: fresh
  `prisma migrate deploy` from empty database, `db:seed`, and a smoke pass
  covering the advisory lock, the durable event outbox, transfer-evidence/
  item-photo BYTEA storage, the transfer-receipt row-locked upsert path
  (including the duplicate-request idempotency check), and the import
  reversal's multi-row ledger update - all produced the expected stock
  totals.
- Full `api` test suite: 543/544 passing pre- and post-migration in the
  default (in-memory) mode; the new
  `lib/postgres.integration.test.ts` (skipped unless `TEST_DATABASE_URL` is
  set) passes against real Postgres.
