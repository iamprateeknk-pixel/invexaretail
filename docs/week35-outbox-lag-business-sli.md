# Outbox lag / poison-event business SLI on `/ops/metrics`

Closes part of the Week 19 execution-guide scope ("DB pool, queue lag,
reconciliation and business SLIs ... Define SLOs and alert routing") that
was still open: `/ops/metrics` already had request-level RED metrics
(`lib/request-metrics.ts`: rate, error rate, p50/p95/p99 per route) and
process/database health, but no visibility into the durable outbox's own
health - how far behind delivery is, or whether any event has exhausted
retries into `POISON`.

## What was added

`lib/event-bus.ts`: `outboxHealthSnapshot(now?)` - three real Postgres
counts, no new schema:

- `pending` - rows still `PENDING` (matches `lib/outbox-worker.ts`'s own
  `WHERE status = 'PENDING'` claim query).
- `poison` - rows that exhausted retries (Week 7's visible-exception
  design; a POISON row is a silently-failing event by definition, never
  swallowed).
- `oldestPendingAgeSeconds` - age of the oldest still-PENDING row: the
  durable-outbox equivalent of consumer lag.

`routes/command-center.ts`'s `GET /ops/metrics` (admin-only, unchanged
auth) now includes an `outbox` object with these three fields plus an `slo`
block:

```json
"outbox": {
  "pending": 3,
  "poison": 0,
  "oldestPendingAgeSeconds": 42,
  "slo": { "lagBreachSeconds": 900, "poisonBreachCount": 1, "breached": false }
}
```

`undefined` (the field is simply omitted) in memory mode, matching the
existing convention `command-center.ts`'s `databaseExtras()` already uses
for database-only data - a missing database never takes this endpoint
down.

## Honest scope limit: no real alert routing

The guide's Week 19 scope also asks for "SLO ... alert routing". This repo
has no paging/alerting connector (Slack, PagerDuty, email) configured
anywhere to route an alert to, so building a real alerting integration here
would mean inventing a destination that doesn't exist. Instead, the SLO
thresholds are computed and exposed as a `breached` boolean directly on
this endpoint - a real, queryable signal an operator (or a future alerting
integration, whenever one is wired up) can act on, rather than a
fabricated "alerting configured" claim. Thresholds and their reasoning are
inline constants in `command-center.ts`:

- `OUTBOX_LAG_BREACH_SECONDS = 900` (15 min) - delivery/backoff retries
  every few seconds normally; stuck for 15 minutes means the worker itself
  is stuck, not merely backing off.
- `OUTBOX_POISON_BREACH_COUNT = 1` - zero tolerance, matching Week 7's own
  "visible exception, never silently dropped" design for POISON rows.

## Testing

- `src/lib/event-bus-outbox-health.postgres.test.ts` (real Postgres, per
  AGENTS.md's rule that `lib/event-bus.ts`'s outbox concerns need database
  coverage): a DELIVERED row never counts as pending; `poison`/`pending`
  count correctly across mixed rows; `oldestPendingAgeSeconds` tracks the
  genuinely oldest PENDING row, not a newer one from a concurrent test/
  company.
- `src/lib/event-bus.test.ts` (new, memory mode): `outboxHealthSnapshot()`
  returns `undefined` without touching Prisma when the database is
  disabled - the one branch the Postgres-only suite can't exercise itself.
- `npm test`: 567 passing, 0 failing (108 skipped DB-only tests, one more
  than before since this file's Postgres tests are new and correctly
  skipped without `TEST_DATABASE_URL`). `architecture-lint`: 0 new
  violations. `contract:validate`/`contract:check-drift`: both pass (no
  route contract change - `/ops/metrics` isn't in the versioned OpenAPI
  surface, same as before this change).

## What's still open from Week 19

Full CI security scanning (CodeQL, secret scan, dependency audit) shipped
separately - see `docs/week34-ci-security-scanning-and-syncvault-aead.md`.
Still not attempted, and not safely attemptable without infrastructure
this repo doesn't have: real OpenTelemetry distributed tracing/span export
(would need a collector endpoint to send to), load testing the five golden
journeys at volume, and the failure drills (backup restore, migration
rollback, worker replay under real traffic) - all of these need either a
real staging environment with production-like data and traffic, or human
decisions (target volume, acceptable budgets) this session can't make
unilaterally.
