# Release candidate evidence package

Recorded 2026-10-07 on branch `feat/checklist-completion` (merged to local `main`). Structure follows Appendix B of the
10/10 plan; the checklist in section 3 follows section 20. Every row is `evidence` (with where it comes from),
`partial` (what is proven and what is not) or `not done` (and what it needs). Nothing here is claimed from source code
alone: "a feature existing in source code is not evidence that the production workflow is safe".

## 1. Identity

| Item | Value |
|---|---|
| Commit | `git rev-parse HEAD` of the merge commit on `main` (this file is committed with it) |
| Runtime | Node 24.19, PostgreSQL 17 (Docker), Flutter/Dart per `mobile/pubspec.yaml` |
| Contract | OpenAPI `2026.17.0`, 41 paths (`api/contracts/openapi.json`), generated client in CI drift check |
| Migrations | 38 (`api/prisma/migrations`), all additive for one release window; money columns widen/round in place (see rollback) |

## 2. Evidence by Appendix B item

### CI summary (run locally; the same commands CI runs)

| Suite | Result |
|---|---|
| API typecheck (`tsc --noEmit`) | clean |
| `architecture-lint` | 0 new violations, 1 tracked (a legacy runtime-DDL line); `float-money` rule reports **zero** |
| API memory-mode tests | 1031 tests, 809 pass, 0 fail (the rest are the Postgres suites, skipped without a database) |
| Real-Postgres suites | 57 of 57 files pass (section 4) |
| OpenAPI validate / drift / typecheck | pass |
| Web tests / component tests / build / lint | 158 / 38 pass / builds / 0 errors |
| Flutter analyze / test | no issues / 138 pass |
| Playwright | 3 specs authored and listed; **not executed here** (no browser binary is installed; downloading one was not authorised). They run in CI. |
| Security gates | dependency audit gate with owned, expiring exceptions (`security/audit-exceptions.json`, expire 2026-12-31); secret scan and CodeQL run in GitHub Actions, not here |

### Migration output and schema-version verification

`node scripts/migration-matrix.mjs --admin-url ... --behind 4 --docker invexa-pg` on this commit:

```
PASS  fresh: empty database -> all migrations  (38 migrations applied, no drift)
PASS  upgrade: previous release (4 migrations behind, with data) -> latest
      (4 migrations applied over live data; 25 items and 25 ledger rows intact, no drift)
PASS  restore: dump -> restore into an empty database
      (95 tables and 77 rows identical; migration history intact; no drift; next deploy is a no-op)
```

### Cross-tenant negative suite

Every tenant-scoped slice has a real-Postgres test that creates the row under company A, attempts the operation as
company B with the real id, expects **404 (never 403)**, asserts the row is untouched, and runs the identical call
as company A to prove the rejection is the tenant check. Listed in `docs/release-evidence/plan-10of10-tracker.md`
(rules/QC, webhooks, approvals, saved reports, serials, photos, permissions, pick waves, bins, putaway, price lists,
Entity 360, plus the earlier item/order/PO/transfer/count/exception/asset/lot/comment/notification slices). Most of them
were also run against the previous route code and shown to fail there.

### Inventory reconciliation report

Local database, company `default-company`, `POST /ops/reconciliation/run`:

| | before the opening-journal backfill | after (`scripts/backfill-opening-journal.cjs --apply`) |
|---|---|---|
| ledger rows | 11 | 11 |
| explained by the journal | 0 | **11** |
| journal mismatches (breach) | 0 | **0** |
| `NO_JOURNAL_HISTORY` (legacy baseline) | 11 | **0** |
| max absolute delta | 80 | **0** |

The backfill adds one opening-balance movement per balance that has no history. It never edits a balance or a movement,
only touches balances with no posted movement, is idempotent, is dry-run by default, and is proven on Postgres
(`opening-journal-backfill.postgres.test.ts`, including "a real mismatch is left alone"). Run it once per environment,
then `POST /ops/reconciliation/run`.

### Load and performance report (p50 / p95 / p99)

Local, single API process + PostgreSQL 17 in Docker on a developer laptop, **20,006 items** in the company, 20 concurrent
workers, 15 s per endpoint, enterprise plan (the default "pro" plan meters 20,000 requests/day):

| Endpoint | requests | errors | rps | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|
| `GET /items/search?limit=25` | 5,567 | 0 | 370 | 50 | 74 | 92 | 463 |
| `GET /transfers/list` | 21,367 | 0 | 1,423 | 13 | 23 | 39 | 236 |
| `GET /reports/dashboard` | 2,471 | 0 | 164 | 117 | 163 | 177 | 204 |
| `GET /reports/exceptions` | 7,893 | 0 | 526 | 34 | 56 | 75 | 295 |

All four are inside the 500 ms p95 budget. This is a read-path probe on one machine, **not** a production-like run:
mutation latency, a managed database and real network distance are not measured. Re-run with
`API_URL=<staging> npm run load:test` on the staging stack before relying on it.

The load test found a real bug, fixed in this change: the "daily API request" cap never reset, so a company on a
20,000/day plan was locked out for good after 20,000 lifetime requests (`company-access.test.ts` proves the rollover).

### Event freshness and reconnect

`events-freshness.http.test.ts`: 60 events published at 10 ms intervals reach a connected SSE client with p95 inside the
250 ms budget and none lost; a client that drops and reconnects with its last event id receives exactly the events it
missed, in order, once, inside 1 s.

### Android target-device record

**Not done.** No device or emulator is available in this environment. What is covered by the Dart test suite (138 tests):
identity-bound offline queue (company + user + device), retry classifier and backoff, ordered flush, single-flight token
refresh, offline read model (cold start with no network shows the last snapshot, sign-out erases it), one-time web
handoff, environment/flavor hardening, lazy tabs. The count / pick / receive / putaway golden journeys on a target
device, camera permission flows and process-death recovery on hardware still need a person with a device.

### Backup / restore drill

Local: the matrix's `restore` case above (dump, restore into an empty database, 95 tables / 77 rows identical, no drift).
Managed-database restore against real data volume, and a check that backups are actually being taken and monitored,
**not done** (needs the Railway project).

### Rollback / roll-forward rehearsal

Rehearsed locally: the release before the decimal and tenant-scope slices (`306ecb9`, built from its own worktree with
its own Prisma client) was started against the **newer** schema (all 38 migrations, money columns already NUMERIC).
It booted, served items search, transfers, purchase orders, suppliers, rules, prices, reports, locations and metrics (all HTTP 200),
and **writes** through it (a purchase order with a unit cost and freight, an approval rule with a threshold, a price)
succeeded; the new release then read those rows back correctly as numbers (`totalAmount 12.75`, `freightCost 10.5`,
`price 19.99`). So "roll the application back first, do not run a down-migration" holds for this change set.
A staged production rollback (Railway previous deployment + Worker previous version) is **not done**.

### Open-risk list

| Risk | Owner | Date | Note |
|---|---|---|---|
| Playwright specs unexecuted here | repository owner | next CI run | authored and listed; first CI run is the proof |
| Android device journeys | repository owner | before store release | needs hardware |
| Managed DB restore drill, backup monitoring | repository owner | before go-live | needs Railway |
| Production-like load (mutations, managed DB) | repository owner | staging | probe above is local reads only |
| Dependency-audit exceptions | repository owner | 2026-12-31 | owned, expiring |
| Handoff stores are in memory (single API replica) | repository owner | before scaling out | Control Plane and web handoff codes live 60 s |
| Alert destination | repository owner | before go-live | set `ALERT_WEBHOOK_URL`; no paging vendor is bundled |

## 3. Section 20 checklist

Legend: **E** evidence in this repository, **P** partial, **N** not done.

### Security / tenancy

| | | Evidence |
|---|---|---|
| E | Foreign company IDs cannot read, mutate or disclose existence | negative Postgres suites (404 not 403) across items, orders, POs, transfers, counts, exceptions, assets, lots, comments, notifications, rules, QC, webhooks, approvals, reports, serials, photos, permissions, waves, bins, putaway, prices, Entity 360 |
| E | Lot, AssetCheckout, ContextComment, UserNotification company-scoped | `operations-extension-p0-company-scope.postgres.test.ts` |
| P | Privileged control session hardened and revocable | one-time 60 s handoff code instead of a session in the URL, tab-scoped storage, admin-panel clears its copy, kill switch and lock revoke; a true HttpOnly cookie is impossible across the two origins |
| E | Secret scanning and high-severity gates | `security.yml` (gitleaks, CodeQL, blocking audit gate) - execute in GitHub Actions |

### Stock / database

| | | Evidence |
|---|---|---|
| P | All stock mutations use canonical posting/reservation services | the canonical service and posting coverage doc exist; a number of legacy call sites remain allowlisted in `architecture-lint` (`docs/inventory-posting-coverage.md`) |
| E | Zero unexplained reconciliation deltas | table above: 11/11 explained, 0 mismatches, 0 baseline after the opening-journal backfill; nightly runs + evidence table + alert on breach |
| E | No critical money field uses Float | `float-money` lint reports zero; decimal slices 1-7 |
| E | Concurrent reservation/posting prove no lost update | `reservation.postgres.test.ts`, `inventory-posting-service.postgres.test.ts` (real overlapping calls) |

### Realtime / performance

| | | Evidence |
|---|---|---|
| E | Healthy SSE clients do not poll broadly every 15 s | `poll-policy.js` + test (180 s safety poll when live) |
| E | No end-user GET triggers full repository hydration | background `RepositoryReconciler`, off the request path |
| P | Production-like p95 budgets | local read probe above; staging run outstanding |
| E | Event-to-visible freshness during reconnect | `events-freshness.http.test.ts` |

### Web UX

| | | Evidence |
|---|---|---|
| E | Role landing pages and navigation | `role-landing.test.js`, `defaultSectionForRole` |
| E | Major queues share DataTable patterns | `TableToolbar` + `useTableView` on exceptions, orders, purchase orders, QC, assets, jobs, transfers, count tasks, connectors: search, density, saved views, URL state, CSV export (formula-injection safe), column manager (purchase orders, transfers); client-side filtering of loaded rows, **not** server-side pagination |
| E | Routes lazy load | every page `lazy()`; build chunks |
| E | Keyboard, responsive and non-color-only checks | real browser: 28 sections at 375 px with no horizontal page scroll; 474 interactive controls across all 28 sections, all with an accessible name (10 unnamed controls found and fixed); statuses are text badges |
| P | Dashboard KPIs reconcile and charts drill down | KPI cards link to the exact filtered queue; a numeric reconciliation test of every card against its source queue was not written |
| E | Global search / command palette, saved views, density | `CommandPaletteDialog` (items + pages), saved views per user, density |
| E | Lot/Location/Transfer/Count/User 360 + timelines (Item 360 is the stock-detail page) | `GET /entities/:type/:id/360`, `Entity360Page`, `entities.postgres.test.ts`; opened in a real browser from a location to a transfer |
| P | Loading/empty/error/offline/stale/conflict states | shared `feedback-states` components and tests; "stale" is the mobile snapshot banner; no chart-fallback regression test |
| N | Usability tests of the top five tasks per role | needs people |

### Android

| | | Evidence |
|---|---|---|
| N | Count/Pick/Receive/Putaway golden journeys on target devices | needs devices |
| E | One SQLite outbox is the only offline mutation engine | schema v4: counts and actions are `sync_commands` rows; no other offline write store exists (web has none, the legacy JSON store is gone) |
| P | Cold-start offline and process-death recovery | cold start with no network shows the last snapshot (tested); the queue survives process death by construction (SQLite) - not exercised on a device |
| E | No second login for a capability shown inside the signed-in app | one-time web handoff: API + web + app; verified end to end in a real browser (no login form, code removed from the URL, no refresh token in storage) |

### Offline / sync

| | | Evidence |
|---|---|---|
| E | Queued commands are company/user/device scoped | `offline_identity_test.dart` |
| E | Retries exactly-once, transient statuses back off | `X-Mutation-Id` receipts (Postgres), classifier + backoff tests |
| E | Conflicts need explicit resolution; rejects not retried forever | `sync_resolution` tests, Conflict Center |
| E | Admin can see sync health and stuck work | `GET /ops/sync-health`, alert `sync-stuck` |

### Testing / release

| | | Evidence |
|---|---|---|
| E | Critical real-Postgres invariant suites green | section 4 |
| P | Golden Playwright and mobile device journeys | Playwright authored/listed (CI executes); mobile devices not available |
| E | Fresh/upgrade/restore migration matrix | section 2 |
| P | No unowned P0/P1 risk | all P0/P1 tickets in Appendix A are closed or tracked; the open-risk list above names an owner for each remaining item |

### Operations / DR

| | | Evidence |
|---|---|---|
| P | Canonical deploy runbook works from a clean checkout | `docs/PRODUCTION_RUNBOOK.md`; the API image builds from source (`api/dist` is no longer committed); not executed against Railway here |
| P | Backups monitored, latest restore drill meets RPO/RTO | local restore proven; managed backups not checked |
| P | Rollback or roll-forward rehearsed | local rehearsal above; not on Railway |
| P | Alerts, dashboards, request IDs, release identifiers live | alert sweep to `ALERT_WEBHOOK_URL` (outbox poison/lag, stock mismatch, stuck sync; tested on Postgres), `/ops/metrics`, request ids and `release` in `/health`; no destination is configured and there is no hosted dashboard |

## 4. Real-Postgres suite

Result of `for f in *.postgres.test.ts; do tsx --test $f; done` against PostgreSQL 17 on this commit:
**57 of 57 files pass** (one process each, freshly seeded database).

## 5. Decision

**Recommendation: NO-GO for production on this evidence alone**, with a narrower gap than before. What is left is
verification that needs infrastructure or people (device journeys, usability tests, a staging load run, a managed
restore/rollback drill, configuring the alert destination), not unbuilt functionality. Only the human owner can approve
production; branch protection, a signed build and the hosting decision are theirs.
