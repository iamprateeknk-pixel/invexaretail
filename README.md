# Invexa Retail

Multi-tenant retail inventory, warehouse-transfer, counting, procurement and order-management platform.

> **Status: release candidate work in progress - not production-approved.** The 20-week execution guide is only partly complete; the honest per-week status, including what still needs staging, devices or a human decision, is in [docs/guide-status.md](docs/guide-status.md). A green build is not a release approval ([release scorecard](docs/release-evidence/release-scorecard.md)).

## Repository layout

| Path | What it is | Deployed as |
|---|---|---|
| `api/` | Express + Prisma + PostgreSQL backend, worker, OpenAPI contract | Render web service + worker (`render.yaml`) |
| `web/` | Vite/React operations workspace (shadcn/ui, design tokens) | Cloudflare (`web/wrangler.toml`) |
| `admin-panel/` | SaaS control-plane UI (tenants, entitlements, API keys, kill switches) | separate build |
| `mobile/` | Flutter Android client (counts, pick, receive, putaway, scan; offline SQLite queue) | signed AAB/APK, `.github/workflows/android-apk.yml` |
| `docs/` | ADRs, runbooks, per-week evidence, security/SLO policy | - |

Architecture rules that bind every change live in [AGENTS.md](AGENTS.md) and [docs/adr/](docs/adr/) (ADR-001..006): one canonical stock journal, mandatory tenant scope, rotating refresh sessions, Prisma migrations as the only schema authority, bounded contexts, versioned contract + idempotency + outbox.

## Requirements

- Node.js 22.12+ · npm
- PostgreSQL 17 (Docker: `docker compose up -d postgres`)
- Flutter stable (mobile only; CI pins 3.47.2) and JDK 17

## Run it locally

```bash
docker compose up -d postgres
cd api
npm ci
npm run db:migrate      # prisma migrate deploy - the only way schema changes reach a database
npm run db:seed         # demo data (needs SEED_PASSWORD)
npm run build
npm start               # http://127.0.0.1:4000  (/health, /ready)
```

Set `DATABASE_URL`, `JWT_SECRET`, `SEED_PASSWORD` in your environment (see `api/.env.example`). With `DATABASE_URL` unset the API runs in seed-only memory mode for local/demo use; release verification must use PostgreSQL.

```bash
cd web && npm ci && npm run dev            # workspace on the Vite dev server
cd admin-panel && npm install && npm run build
cd mobile && flutter pub get --enforce-lockfile && flutter run
```

## Verify a change

| Area | Command (from the folder) | Notes |
|---|---|---|
| API build | `npm run build` | `prisma generate && tsc` |
| API tests | `npm test` | in-memory mode; real-Postgres suites skip unless `TEST_DATABASE_URL` is set |
| Real-Postgres suites | `TEST_DATABASE_URL=... npx tsx --test src/**/X.postgres.test.ts` | run **one file at a time** - they share database state; CI discovers and runs each `*.postgres.test.ts` separately |
| Architecture rules | `node scripts/architecture-lint.mjs --check` | prohibited patterns; existing violations are tracked in a baseline, new ones fail |
| API contract | `npm run contract:validate && npm run contract:check-drift` | regenerate with `npm run contract:generate` after editing `contracts/openapi.json` |
| Web | `npm test`, `npm run test:components`, `npm run lint`, `npm run build`, `npm run test:e2e` | e2e uses Playwright |
| Mobile | `flutter analyze && flutter test` | |

CI: `.github/workflows/ci.yml` (build, tests, architecture lint, contract, Postgres suites, web, admin, mobile analysis), `security.yml` (CodeQL, dependency audit, secret scan, image scan - see [docs/security-gates.md](docs/security-gates.md)), `android-apk.yml` (pinned, signed release build).

## Operating it

- Deploy / rollback / backup-restore: [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md), [docs/deployment-railway-cloudflare.md](docs/deployment-railway-cloudflare.md), [docs/release-evidence/week-01-containment/backup-restore-runbook.md](docs/release-evidence/week-01-containment/backup-restore-runbook.md)
- SLOs, alerts and tracing (OpenTelemetry via `OTEL_EXPORTER_OTLP_ENDPOINT`): [docs/slo-and-alerting.md](docs/slo-and-alerting.md)
- Offline mobile contract and local database: [docs/offline-contract-and-mobile-store.md](docs/offline-contract-and-mobile-store.md)
- Where each route lives and what is still in the two large routers: [docs/route-ownership-matrix.md](docs/route-ownership-matrix.md)
- Tenant scope coverage: [docs/tenant-scope-coverage.md](docs/tenant-scope-coverage.md)

## Known gaps (also tracked in [docs/guide-status.md](docs/guide-status.md))

- Float -> Decimal conversion for money/quantity is prepared ([docs/decimal-migration-plan.md](docs/decimal-migration-plan.md)) but **not executed**; landed cost and matching still use binary floats.
- `core.ts` and `operations-extension.ts` are still large routers being extracted slice by slice.
- Evidence uploads validate magic bytes and size and are served through signed expiring links, but there is no malware scan or object storage yet (infrastructure).
- Physical-device validation, load tests at agreed volume, failure drills and the canary/rollback rehearsal have not been run; they need a staging environment and people.
- iOS: there is no iOS build or release path, so iOS is **not supported**. Whether it stays out of scope is an open owner decision (see guide-status).

The previous, much longer README described a pre-Postgres prototype and made "production ready" claims the code does not support; it is archived at [docs/archive/README-legacy-v1.md](docs/archive/README-legacy-v1.md).
