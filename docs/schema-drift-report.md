# Schema drift report (Week 5 / ADR-004)

Compares three things the guide asks to be compared: a clean migration
build, a restored-and-upgraded staging copy, and the declared Prisma
schema. All commands below were actually run against local Postgres 16
(not simulated) as part of this week's work; exit codes and row counts are
copied verbatim from that run.

## 1. Clean migration build vs declared schema

```
$ createdb retail_drift_check
$ DATABASE_URL=postgresql://.../retail_drift_check npx prisma migrate deploy
Applying migration 20260922123350_init_postgres
Applying migration 20260922130000_session_otp_model
All migrations have been successfully applied.

$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
No difference detected.
$ echo $?
0
```

**Result: zero drift.** A database built from nothing but
`prisma migrate deploy` matches `schema.prisma` exactly.

## 2. Restored staging (older schema + real data) upgraded, vs declared schema

Simulated an existing deployed database that predates the Week 3 session/OTP
migration (i.e. only `20260922123350_init_postgres` applied), seeded with
real data (`npm run db:seed`: 3 items, 5 users), then upgraded through the
same production path (`npm run db:migrate` = `prisma migrate deploy`):

```
$ psql retail_restored_staging -c 'SELECT COUNT(*) FROM "Item"'   -- before: 3
$ psql retail_restored_staging -c 'SELECT COUNT(*) FROM "User"'   -- before: 5

$ DATABASE_URL=postgresql://.../retail_restored_staging npm run db:migrate
Applying migration 20260922130000_session_otp_model
All migrations have been successfully applied.

$ psql retail_restored_staging -c 'SELECT COUNT(*) FROM "Item"'   -- after: 3 (unchanged)
$ psql retail_restored_staging -c 'SELECT COUNT(*) FROM "User"'   -- after: 5 (unchanged)

$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
No difference detected.
$ echo $?
0
```

**Result: zero drift, zero data loss.** The restored-and-upgraded database
converges to the same declared schema as the fresh install, through the
identical migration chain, with every pre-existing row intact.

## 3. Runtime CREATE/ALTER inventory

```
$ grep -rn "CREATE TABLE\|ALTER TABLE\|DROP TABLE" --include=*.ts src | grep -v '\.test\.ts'
(no output)
```

Zero runtime DDL in the current codebase - retired in Week 2 (ADR-004):
`lib/foundation-schema.ts` and `lib/runtime-schema.ts` are both no-ops kept
only so their call sites don't need to change; every table they used to
hand-create with MySQL DDL was already a Prisma model. The MySQL-dialect
migrations that predate the Postgres switch are archived (not replayed) at
`api/prisma/migrations_mysql_archive/`.

## 4. Runtime DDL retirement plan (already executed, documented here per the Week 5 deliverable list)

| Step | Status |
|---|---|
| Inventory every runtime CREATE/ALTER path | Done - zero found (see §3) |
| Disable runtime DDL in staging/production | Done in Week 2 - `ensureFoundationSchema()`/`ensureDailySyncSchema()` are no-ops |
| Startup verifies schema version instead | Done this week - `lib/schema-version.ts`'s `verifySchemaVersion()`, wired into `GET /ready` (returns 503 with `SCHEMA_VERSION_MISMATCH` and a plain-English hint, never runs DDL) |
| Compare declared schema vs live database at every deploy | `npm run db:verify` (`scripts/verify-production-db.cjs`) checks `_prisma_migrations` exists and the database answers; `verifySchemaVersion()` at runtime checks the exact migration set matches |

`verifySchemaVersion()` is read-only by construction: it runs one
`SELECT` against `_prisma_migrations` and returns a description of any
drift, and its own test suite
(`api/src/lib/schema-version.postgres.test.ts`) includes an explicit
assertion that the database's table set is identical before and after
calling it.

## Conclusion

There is no schema-authority ambiguity to resolve for this repository
today: Prisma migrations are already the sole source of truth (ADR-004,
Week 2), fresh and restored-and-upgraded databases both converge to that
declaration with zero manual reconciliation, and startup now fails closed
with a specific, actionable message if a database ever falls behind -
instead of silently serving traffic against a mismatched schema or
attempting to fix it at boot.
