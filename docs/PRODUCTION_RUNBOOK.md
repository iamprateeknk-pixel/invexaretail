# Production runbook

This is the one canonical production map; where any other note disagrees with
this page, this page wins. Cloudflare Workers, Railway, Render and Vercel are
retired (2026-11-27) and their config files removed: production runs on the
team's own cloud host with Docker Compose behind Nginx.

## 1. Topology

| Piece | Public URL | Runs as (`docker-compose.yml` service) | Config |
|---|---|---|---|
| Web app | `https://invexaretail.com` | `web` (Nginx, `web/nginx.conf`, SPA fallback) | build var `VITE_API_BASE` |
| API | `https://invexaretail.com/api/v1` and `/control/v1` (same host) | `api` (`api/Dockerfile`, `node dist/index.js`, `RUN_SCHEDULERS=false`) | env below |
| Worker | none (no HTTP) | `worker` (same image, `node dist/worker.js`) | same env as API |
| Control Plane UI | `https://admin.invexaretail.com` (host port 18181) | `admin` (Nginx, `admin-panel/nginx.conf`) | build args `VITE_API_BASE`, `VITE_WEB_APP_URL` |
| Database | private | `postgres` (PostgreSQL 17) or an external `DATABASE_URL` | migrations only |
| Mobile (Android, iOS, Windows) | - | `.github/workflows/{android-apk,ios,windows}.yml` | `--dart-define=INVEXA_ENV`, `INVEXA_API_BASE` (default `https://invexaretail.com`) |

The host's public Nginx terminates TLS. On the workspace domain it can forward
all traffic to the Compose web service, which routes `/api/v1`, `/control/v1`,
`/studio/v1` and `/sync/v1` to the API container. It also forwards `/health`,
`/ready` and `/meta`. If the host proxies API traffic directly, configure
these routes there. The admin domain proxies to port 18181. Compose publishes
service ports on the host's loopback interface. The `worker` service is required: staged import commits,
outbox delivery and retention, the expiry sweep, stock reconciliation and alerts
run only there.

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
| `ALLOWED_ORIGINS` | optional | Extra web origins. `https://invexaretail.com`, `https://www.invexaretail.com` and `https://admin.invexaretail.com` are always allowed (`lib/cors-origins.ts`). |
| `TOTP_ENCRYPTION_KEY` | to offer 2FA | 32 bytes, base64. Unset = 2FA reported "not configured". |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` | to offer passkeys | RP ID is the web app's registrable domain (e.g. `app.example.com`); origins is a comma list of exact web origins (`https://app.example.com`). Unset = passkeys reported "not configured" (503). Optional `WEBAUTHN_RP_NAME`. |
| `API_RATE_LIMIT_PER_MINUTE` | optional | Per-IP limit, default 240. Raise for a branch behind one NAT. |
| `RUN_SCHEDULERS` | API: `false` | Schedulers belong to the worker. |
| `RECONCILE_INTERVAL_HOURS` | worker, default 24 | Nightly stock reconciliation. |
| `DATABASE_REFRESH_INTERVAL_MS` | optional, default 30000 | Snapshot reconciliation interval (off the request path). |
| `ALERT_WEBHOOK_URL` | strongly recommended | Where breaches are pushed (outbox POISON or stuck >15 min, stock mismatch, stuck offline commands). A Slack incoming webhook or any endpoint accepting JSON. Unset = nothing is sent. Runs in the worker. |
| `ALERT_SWEEP_MINUTES` | optional, default 5 | How often the worker checks. A standing breach is announced once, repeated every 6 h, and reported as resolved when it clears. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | optional | Tracing; unset = off. |
| `APP_VERSION` / `GITHUB_SHA` | set by CI | Reported by `/health` and `/meta`. |

Web uses `VITE_API_BASE` at build time. Native clients use `INVEXA_ENV`
(`production` by default), `INVEXA_API_BASE`, and `INVEXA_WEB_APP_URL`.
Staging requires both HTTPS origins explicitly. Production and staging
reject private hosts. See the [native setup](../mobile/README.md#run-locally).

For staging Compose, set `INVEXA_ENV=staging`, the full `GITHUB_SHA`, and a
dedicated `DATABASE_URL`. Set `VITE_API_BASE` and `VITE_WEB_APP_URL` to the staging
API and workspace HTTPS origins, and set `PUBLIC_CONTROL_URL` to the staging
admin HTTPS origin. Include the workspace and admin origins in `ALLOWED_ORIGINS`.
The API checks this configuration at boot. The staging admin issues the
handoff code and the workspace redeems it once. Set
`REQUIRE_STUDIO_RELEASE_REVIEW=true` to require independent review for publication.
The worker accepts `ALERT_WEBHOOK_URL` from the environment when alerts are configured.
CI exercises the Compose routing, sign-in and handoff with a temporary database
and synthetic accounts.

## 3. Release

After the approval binding migration, existing approval rows remain available
for history. For an operation that is still pending, the original requester
resubmits the command to create an approval linked to its current details.
Verify the new request before retrying any stock movement or purchase order.

Studio approval workflows start in simulation. Once the new API is staged,
enable and publish a workflow, then verify the exact threshold, an independent
reviewer, and the required location assignment for a branch manager. Rehearse
rollback before enabling live policies in production. Studio requests retain a
rule reference so older images can read approval history. Stop approval writes
and affected inventory commands during a rollback to an image that predates
Studio enforcement, since it cannot enforce the published policies or reviewer location.

1. CI green on the merge commit: API build/lint/tests, every real-Postgres suite,
   the migration matrix, web tests/build/E2E, audit gate, gitleaks.
2. Staging first when one exists: migrate, then
   `API_URL=<staging> LOAD_PASSWORD=<...> npm run load:test -- --duration 30 --concurrency 20 --p95-budget-ms 500`.
3. On the cloud host, set `GITHUB_SHA` to the full approved release commit.
   Build `api`, `worker`, `web`, and `admin` from that revision. Run
   `docker compose run --rm api sh -ec 'npm run db:migrate && npm run db:verify'`
   before `docker compose up -d`. The API image owns migrations. The worker
   has no migration command and refuses to start on an incomplete schema.
4. Check `GET /health`, `/ready`, `/meta` report the new release and a ready schema.
5. Confirm the web app's `/assets/index-*.js` hash changed and
   `https://admin.invexaretail.com/health` answers `{"ok":true,"panel":"control-plane"}`.
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

- Backups: a self-hosted database has **no automatic backup** - schedule one on the
  host (at least a daily `pg_dump -Fc` copied off the machine; WAL archiving for
  point-in-time recovery). Targets: RPO <= 24 h with daily dumps (<= 15 min with
  PITR), RTO <= 60 min. Record the schedule and where copies go here once set.
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

1. Roll back the application first, not the database: `git checkout <previous tag>`
   on the host, then `docker compose build api worker web admin && docker compose up -d`.
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
