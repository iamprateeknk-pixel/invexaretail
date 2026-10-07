# Production runbook

This is the one canonical production map. Other deployment notes in this
repository (`render.yaml`, `DEPLOY_NOW.md`, `api/vercel.json`, Hostinger-era
files, `docs/deployment-railway-cloudflare.md` details) are history or
fallbacks; where they disagree with this page, this page wins.

## 1. Topology

| Piece | Where | Config | Deploys from |
|---|---|---|---|
| Web app | Cloudflare Worker `invexaretail-web` (static assets + SPA fallback) | `web/wrangler.toml`, build var `VITE_API_BASE` | `main`, or `npm run deploy` from a clean clone |
| Control Plane UI | Cloudflare Worker `invexaretail` | `admin-panel/` | same |
| API | Railway service (Dockerfile, `api/`) | env below | `main` |
| Worker | Railway service, `api/railway.worker.json` (`node dist/worker.js`) | same env as API | `main` |
| Database | Managed PostgreSQL 17 (Railway) | `DATABASE_URL` reference | migrations only |
| Mobile | Android APK/AAB via `.github/workflows/android-apk.yml` | `--dart-define=INVEXA_ENV`, `INVEXA_API_BASE` | tagged build |

Do not add a second production path. A new environment is the same topology
under different names.

## 2. Environment contract

API and worker (never commit values; set in the platform's secret store):

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV=production` | yes | Enables the startup secret guard. |
| `DATABASE_URL`, `REQUIRE_DATABASE=true` | yes | The API refuses to run without it. |
| `JWT_SECRET` | yes | 32+ random chars. Missing, a placeholder or under 16 chars stops the process at boot (`lib/production-guard.ts`). |
| `OTP_PEPPER` | recommended | Defaults to `JWT_SECRET`. Must not be a placeholder. |
| `SEED_PASSWORD` | only when seeding | Must not be the repository default. |
| `ALLOWED_ORIGINS` | yes | Exact web origins. |
| `TOTP_ENCRYPTION_KEY` | to offer 2FA | 32 bytes, base64. Unset = 2FA reported "not configured". |
| `API_RATE_LIMIT_PER_MINUTE` | optional | Per-IP limit, default 240. Raise for a branch behind one NAT. |
| `RUN_SCHEDULERS` | API: `false` | Schedulers belong to the worker. |
| `RECONCILE_INTERVAL_HOURS` | worker, default 24 | Nightly stock reconciliation. |
| `DATABASE_REFRESH_INTERVAL_MS` | optional, default 30000 | Snapshot reconciliation interval (off the request path). |
| `ALERT_WEBHOOK_URL` | strongly recommended | Where breaches are pushed (outbox POISON or stuck >15 min, stock mismatch, stuck offline commands). A Slack incoming webhook or any endpoint accepting JSON. Unset = nothing is sent. Runs in the worker. |
| `ALERT_SWEEP_MINUTES` | optional, default 5 | How often the worker checks. A standing breach is announced once, repeated every 6 h, and reported as resolved when it clears. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | optional | Tracing; unset = off. |
| `APP_VERSION` / `GITHUB_SHA` | set by CI | Reported by `/health` and `/meta`. |

Web: `VITE_API_BASE` (public HTTPS API domain; build-time). Mobile: `INVEXA_ENV`
(`production` default) and `INVEXA_API_BASE`; a production build refuses http and
private hosts.

## 3. Release

1. CI green on the merge commit: API build/lint/tests, every real-Postgres suite,
   the migration matrix, web tests/build/E2E, audit gate, gitleaks.
2. Staging first when one exists: migrate, then
   `API_URL=<staging> LOAD_PASSWORD=<...> npm run load:test -- --duration 30 --concurrency 20 --p95-budget-ms 500`.
3. Production: Railway runs `npm run db:migrate && npm run db:verify` as the
   pre-deploy step (`prisma migrate deploy`; never `db push`).
4. Check `GET /health`, `/ready`, `/meta` report the new release and a ready schema.
5. Deploy web (`cd web && npm ci && npm run build && npm run deploy`), confirm the
   `/assets/index-*.js` hash changed.
6. Watch `GET /ops/metrics` for 30 minutes: `outbox.slo.breached`,
   `stockReconciliation.breached`, `reconciliation.stale` must all be false.

### One-time data steps (per environment)

- **Opening-balance journal.** Balances created before the posting service have no movement history and show up as
  `NO_JOURNAL_HISTORY`. Give each one an opening row so the journal explains it:
  `cd api && npm run build && DATABASE_URL=... node scripts/backfill-opening-journal.cjs` (dry run), then
  `--apply` (optionally `--company <id>`). It only adds rows, never edits a balance or movement, and is safe to re-run.
  Then `POST /ops/reconciliation/run` and expect `noJournalHistory: 0, mismatches: 0`.
- **Money columns.** The migrations that turned Float money columns into NUMERIC round existing values (2 dp for totals and
  charges, 4 dp for unit costs). Each migration's header has the query that lists rows whose value would change; run it
  on a backup first and review any row it returns.

### Migration policy

Additive and backward compatible across one release window (new tables/columns with
defaults; code that works with and without them). A destructive migration ships one
release after the code stopped using the thing, behind a verified backup. Large
backfills are chunked and resumable. Any migration touching stock runs
`POST /ops/reconciliation/run` afterwards.

## 4. Backup and restore

- Backups: the managed database's automated daily backup plus point-in-time recovery
  where the plan provides it. Targets: RPO <= 15 min with PITR (24 h without),
  RTO <= 60 min. Confirm the retention window in the platform and record it here when set.
- Restore drill (monthly and before a major release), into an isolated database:

```bash
pg_dump -Fc -f drill.dump "$SOURCE_URL"
createdb invexa_restore && pg_restore --no-owner -d invexa_restore drill.dump
cd api && DATABASE_URL=postgresql://.../invexa_restore npx prisma migrate deploy   # must be a no-op
DATABASE_URL=postgresql://.../invexa_restore npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

  then compare per-table row counts with the source and run a stock reconciliation
  against the restored copy. `api/scripts/migration-matrix.mjs --docker <container>`
  automates the dump, restore, row-count, migration-history and drift checks locally.
- Evidence (2026-10-07, local PostgreSQL 17): 95 tables and 77 rows identical after
  restore, migration history intact, no drift, the next `migrate deploy` a no-op.
  The managed-database drill with real data volume still has to be run and recorded.

## 5. Rollback

1. Roll back the application first, not the database: redeploy the previous Railway
   deployment and the previous Worker version
   (`npx wrangler@4.137.0 rollback <version-id> --name invexaretail-web`).
2. Because migrations are additive for one release window, the previous code runs on
   the newer schema. Do not run a down-migration.
3. If a migration itself is wrong: fix forward with a new migration. Restore from backup
   only for data corruption, and only into a new database first (section 4), then cut over.
4. Re-check `/ops/metrics` and run a reconciliation after any rollback.

## 6. Signals, alerts and what to do

| Signal | Where | Alert when | First response |
|---|---|---|---|
| API 5xx / latency | `/ops/metrics` `api`, platform | 5xx > 1 % for 5 min | Check the release in `/meta`; roll back if it started with a deploy. |
| Outbox lag / poison | `/ops/metrics` `outbox.slo` | oldest pending > 15 min, or any POISON | Is the worker up? Inspect POISON rows; do not delete. |
| Snapshot freshness | `/ops/metrics` `reconciliation` | `stale: true` | Database reachable? Restart the API; the last good snapshot keeps serving. |
| Stock reconciliation | `GET /ops/reconciliation` | `mismatches > 0` | See 6.1. |
| Auth | audit log (`TWO_FACTOR_*`, `ACCOUNT_LOCKED` 429s) | spike of locks or refresh-reuse | Treat as credential stuffing; consider tightening the rate limit. |
| Sync queues | mobile Conflict Center, `MUTATION_*` responses | growing conflict/reject counts | Identify device and company from the command row. |

There is no paging backend wired in this repository; these are the queryable signals
and thresholds, and routing them to PagerDuty/Slack is an owner decision.

### 6.1 Reconciliation mismatch

`JOURNAL_MISMATCH` means a balance changed without a journal entry (or the reverse).
Find the row in the run's sample, trace recent movements and audit entries for that
item/lot/location, identify the write path, fix the path first, then correct the
balance with a reasoned adjustment posted through the inventory posting service. Never
edit a movement or balance directly. `NO_JOURNAL_HISTORY` is the legacy baseline: it is
reported, not alerted, and shrinks as call sites migrate.

## 7. Incident handling

| Severity | Meaning | Response |
|---|---|---|
| SEV1 | Cross-tenant exposure, stock corruption, API down for all | Stop the bleeding (kill switch, rollback), then investigate. Preserve logs. |
| SEV2 | One workflow or one company broken | Fix or roll back within the day. |
| SEV3 | Degraded, workaround exists | Next business day. |

Record every SEV1/SEV2 with timeline, root cause, and the test that now prevents it.

## 8. Ownership

| Area | Owner |
|---|---|
| Auth, sessions, tenant scope | repository owner (`.github/CODEOWNERS`) |
| Inventory journal, posting, reconciliation | repository owner |
| Sync/offline (API contract and mobile) | repository owner |
| Imports, worker/outbox | repository owner |
| Web, Android | repository owner |
| Database, deployment | repository owner |

Single-owner is the current reality; the table exists so a second owner can be
named per row without restructuring anything.
