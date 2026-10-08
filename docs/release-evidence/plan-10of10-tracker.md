# Plan 10/10 tracker

State as of 2026-10-07, branch `feat/plan-10of10`. Source: "Invexa Retail 10 of 10 Master Development Implementation Plan (Ultimate UI/UX)".
Status is `done` (code + test evidence), `partial` (shipped slice, named remainder) or `open` (not started / cannot be done from this repository).

| Area | Item | Status | Evidence / remainder |
|---|---|---|---|
| A Architecture | Snapshot reconciled off the request path | done | `lib/repository-reconciler.ts` + test; `/ops/metrics` `reconciliation` |
| A | Database-first reads, drop in-memory snapshot | open | Large refactor; snapshot is now background-reconciled, not removed |
| A | Remaining `core.ts` Transfer routes extracted | open | `docs/route-ownership-matrix.md` |
| B Stock integrity | Canonical posting, job consumption in one transaction | done | `lib/job-consumption-service.ts` + 8 Postgres tests |
| B | Nightly reconciliation with evidence | done | `lib/stock-reconciliation.ts`, `reconciliation_runs` migration, 6 Postgres tests |
| B | Virtual bundles/kits | done | `routes/bundles.ts`, contract entries |
| B | No critical money field uses Float | done | Slices 1-7; `float-money` lint rule reports zero. Unit costs keep 4dp, totals/charges 2dp; `lib/decimal-json.ts` converts at the API boundary; `catalog-procurement-purchase-money.postgres.test.ts` |
| C | Item photos, user permissions, pick waves, bins, putaway tasks company-scoped | done | 404 on foreign ids; Postgres suites `core-photos-permissions`, `warehouse-tenant` (both fail on the old code) |
| C | Webhook subscriptions/deliveries, approval requests, saved reports, serial numbers and command-center counts company-scoped | done | Events deliver only to the producing company's hooks (unattributable events are dropped); migrations `20261118090000`, `20261119090000`; Postgres suites `operations-extension-webhooks`, `tenant-sweep-approvals-reports-serials`, unit tests in `webhook-dispatcher.test.ts` |
| C | Approval/tolerance/evidence rules and QC templates company-scoped | done | Lists, PATCH (404 on foreign id) and `checkApprovalGate`; Postgres test fails on the old code |
| C Tenant security | Asset checkouts, lots, comments, notifications company-scoped (404 not 403) | done | Migration `20261114090000`; 9 negative cross-tenant Postgres tests that failed on the old code |
| C | `PUT`/`DELETE /users/:userId` company-scoped | done | Found while specifying the users contract: both looked the user up in the process-wide list by bare id, so an admin of one company could change the role/password of, or delete, another company's user. Now 404 for a foreign id and untouched; `user-company-scope.http.test.ts` fails on the old code |
| C | Process-wide list endpoints in `core.ts` scoped to the caller's company | done | A sweep of every GET in `core.ts` found six that returned another company's data to any admin: `/imports/history` (daily stock movements), `/audit` (events carry no company, so scoped by the acting user's company), `/export/stock\|counts\|transfers`, `/sync-status` (location names), `/expiry-dashboard?locationId=all`, and `/count-assignments` (only branch managers were filtered). `import-history-company-scope.http.test.ts` and `core-lists-company-scope.http.test.ts` fail on the old code. Not covered by a test: the expiry dashboard. Still open: `planStockUpdate`/`transferImportPlan` match items and locations against the process-wide lists |
| C | ERP / stock-update / item file imports only touch the importing company's own rows | done (memory-tested; the opening-stock SQL path first runs against Postgres in CI/deploy) | Bulk imports matched items by code and branches by name against process-wide lists: one company's file could rewrite another company's item master (`INSERT ... ON CONFLICT (id) DO UPDATE`), set stock at another company's branch (`StockLedger ... DO UPDATE SET onHand`), create items under the default company (`persistItem` had no company), and import-derived ids were identical for every company. Now `planStockUpdate`, `persistOpeningStockImport`, the daily sales/purchase planner and `upsertItemRecord` resolve only the caller's own items/locations; generated ids are namespaced per company except the default one (`scopedImportKey`). `erp-import-company-scope.http.test.ts` fails on the old code |
| C | Transfer import and stock-take import match only the caller's own items | done | `transferImportPlan`/`exactItemMatch` resolved file rows against the process-wide item list, so one company's file could match another company's item (and plan allocations for it), and the destination was looked up in every company's locations. Now company-scoped. `transfer-import-company-scope.http.test.ts` fails on the old code. Still open: the stock-update (`planStockUpdate`) and opening/daily ERP import paths, which also persist through `persistOpeningStockImport`/`persistDailyMovementImport` |
| C | Item code/barcode/alias uniqueness checked per company | done | `POST`/`PUT /items` checked the process-wide item list, so a company could not use a code another company had (the database already enforces `(companyId, code)`), and the 409 message put the other company's item code and name in the response. Now each company checks only its own items. `item-identity-company-scope.http.test.ts` fails on the old code |
| C | `GET /pick-waves` limited to the caller's company | done (CI-verified only) | An Admin listing waves with no `locationId` got scope `{}` and a query with no company filter, so every company's waves came back (a pick wave has no company column; it belongs to its location's company). The last unscoped Prisma read in `core.ts`. `core-pick-waves-scope.postgres.test.ts` - written without a local Postgres, first real run is CI |
| C | Company profile is per company | done (memory-tested; DB hydrate/persist path first runs on deploy) | The profile (name, industry, contact, address) was ONE process-wide record and one DB row (`default`): `GET /company` and `GET /workspace/profile` showed the platform company's profile to every company's Admin, and `PUT /company` by any Admin overwrote it for everybody (the industry also drives which pages every company's menu hides). Each company now has its own profile (default company unchanged, stored in the `default` row; others in the `CompanyProfile` row with their company id). `company-profile-scope.http.test.ts` fails on the old code. Still global and noted: the active workflow/industry pack (`getActiveWorkflow()`) |
| C | `GET /saas/tenants` and `POST /saas/onboard` limited to the platform operator | done | Both only required "an Admin": the Admin of any company could list every tenant and provision new companies with a first Admin account. Now only the Admin of the platform's own (default) company; others get 403. Assumption to confirm: the operator is the default company's Admin (the separate Control Plane is where super admins work). `saas-platform-operator.http.test.ts` |
| C | Lint covers all tenant models | done | `scripts/architecture-lint.mjs` widened, baseline regenerated |
| D Auth | Non-enumerating OTP, password policy, session revoke on disable/change | done | `otp-privacy.http.test.ts`, `admin-user-security.http.test.ts` |
| D | TOTP two-factor with backup codes and lockout | done | `UserTotp`/`AuthLockout`, `/auth/2fa/*` |
| D | Passkeys / WebAuthn | open | Not started |
| D | Control Plane session handoff | partial | One-time 60 s code instead of the session in the URL (`lib/saas/session-handoff.ts`, `/control/v1/sessions/handoff[/exchange]`, 7 tests); web control session now in sessionStorage, admin-panel clears its copy. True HttpOnly cookie not possible across the two origins; handoff store is in-memory (single API replica) |
| E Realtime/perf | Event-first polling with safety poll | done | `lib/poll-policy.js` + test |
| E | Exactly-once mutation replay (`X-Mutation-Id`) | done | `lib/mutation-idempotency.ts` unit + Postgres tests |
| F Web UX | Role landing pages, no offline write queue, fail-clearly policy | done | `lib/workspace.js`, `lib/offline-policy.js` + tests |
| F | DataTable state: URL query, per-user saved views, density | done | `lib/table-state.js` + 9 tests. `components/ui/table-toolbar.jsx` (search, density, saved views; 3 RTL tests) adopted on Exceptions, Orders, Purchase orders, QC inspections, Assets, Jobs, Transfers, Count tasks and Connectors (`hooks/useTableView.js`). state is synced to the URL hash query (`#/orders?q=rice`), so refresh, shared links and manual edits keep it; Admins can now share a view with the whole company (server-backed `SavedView`, entityType `TABLE:<id>`, `hooks/useTeamViews.js`, `saved-views-table.postgres.test.ts`) |
| F | Playwright golden journeys | done (13 specs) | `web/e2e` executed on the installed Chrome (`PLAYWRIGHT_CHANNEL=chrome npx playwright test`): 13 passed - the 3 earlier journeys plus per-role journeys (landing page, short rail, keyboard, Ctrl+K) and axe accessibility scans. The 5 end-to-end *business* journeys in the scorecard are still API/unit level, not browser level |
| F | Role-first navigation: 5-8 primary destinations, rest under More | done | `PRIMARY_NAV_BY_ROLE`/`splitNavigation` (`lib/workspace.js`). Before: Admin saw 27 items, Branch Manager 18, Picker 13, Store user 11. Now every role sees 7-8, the remainder is one click away (and in the command palette); nothing is hidden that the role could open (unit test: primary + more == permitted set). `e2e/role-journeys.spec.js` |
| F | Automated accessibility gate (axe-core, WCAG 2.1 A/AA) | done | `e2e/accessibility.spec.js` fails the build on any serious/critical violation: sign-in, 8 Admin pages, Store-user landing. It found and fixed real defects: primary green had 3.47:1 contrast with white text (now >= 4.5:1), faint nav labels, 12+ unnamed Select triggers and 2 unlabeled inputs (shared `Input`/`Textarea`/`SelectTrigger` now name themselves from the adjacent label - `lib/a11y-name.js`, `a11y-names.test.jsx`), a Tabs `aria-controls` pointing at nothing |
| F | Bundle budget gate | done | `web/scripts/bundle-budget.mjs` (`npm run budget`, CI step): initial JS 224 kB gzip (budget 260), largest lazy chunk 7 kB (budget 40), CSS 16 kB (budget 25) |
| F | Scripted usability test per primary role | open | Needs real people; not something code can provide. The automated role journeys are a regression net, not a substitute |
| G/H Mobile | Identity-bound offline queues, retry classifier, backoff, ordering, single-flight refresh | done | `offline_identity_test.dart`, `sync_resolution` tests |
| G | Environment/flavor hardening, lazy tabs | done | `env_test.dart`, `tab_state_test.dart` |
| H | Single SQLite outbox | done | Schema v4 moves queued counts/actions into `sync_commands` (migration + coexistence tests). Typed-command producers and cold-start offline read model still open; device verification needed |
| H | Admin view of stuck/poison sync work | partial | `GET /ops/sync-health` (`lib/sync-health.ts`): completed/in-flight/stuck receipts per company with a sample; Postgres test incl. tenant isolation. Device-local conflict/reject queues are not visible server-side |
| I Testing/CI | Migration matrix (fresh, upgrade, restore) | done | `scripts/migration-matrix.mjs` + CI step |
| I | Blocking audit gate with owned, expiring exceptions | done | `scripts/audit-gate.mjs`, `security/audit-exceptions.json` (expire 2026-12-31) |
| J Deployment/DR | Canonical runbook, CODEOWNERS, PR template | done | `docs/PRODUCTION_RUNBOOK.md`; restore drill 95 tables / 77 rows identical |
| J | Managed-database restore drill, staging canary | open | Needs real infrastructure. Local equivalents done: restore case of the migration matrix and a rollback rehearsal (older release on the newer schema) - see `release-candidate-evidence.md` |
| J | Remove committed `api/dist` | done | Untracked and ignored; Docker and `postinstall` build it from source; CI step fails if it is tracked again |
| K API contract | OpenAPI v2026.30.0: every operation served (264) is listed; 142 fully specified, 122 path-only | partial | Ratchet test keeps both numbers from dropping. Turning path-only entries into full request/response schemas is ongoing |
| L Readiness | Release scorecard updated | done | `release-scorecard.md` |

## What still blocks a GO

Everything marked `open` above, plus the owner-only items in the scorecard (branch protection, signed build, hosting decision).
The API (Railway) has not been redeployed with this work: new migrations apply on deploy and `JWT_SECRET` must be set or the API refuses to start in production.

## Added in the checklist-completion pass

| Area | Item | Status | Evidence |
|---|---|---|---|
| E | Load test at 20k items with p50/p95/p99 | done (local reads) | `release-candidate-evidence.md`; found and fixed the never-resetting daily API cap |
| E | Event-to-visible freshness and reconnect replay SLO | done | `events-freshness.http.test.ts` |
| F | Column manager and CSV export on the list pages | done | `lib/csv.js`, `TableToolbar`; verified in a real browser (hidden column survives reload via the URL) |
| F | Accessible names on every control | done | real-browser scan of all 28 sections, 474 controls, 10 fixed |
| F | Entity 360 for lot, location, transfer, count, user | done | `lib/entity-360.ts`, `Entity360Page`, Postgres tenant test |
| G | No second login inside the app | done | one-time web handoff (API, web, mobile); verified in a real browser |
| H | Cold-start offline | done (not on a device) | schema v5 `read_model`, `offline_read_model_test.dart` |
| B | Zero unexplained reconciliation deltas | done | opening-journal backfill + `opening-journal-backfill.postgres.test.ts`; live run 11/11 explained |
| J | Alerts pushed to a destination | done (needs `ALERT_WEBHOOK_URL`) | `lib/alerting.ts`, unit + Postgres tests |
| J | Rollback rehearsal | done locally | `release-candidate-evidence.md` |
| F | Dashboard KPIs reconcile to their source queues | done | `dashboard-reconciliation.postgres.test.ts` |
| K | OpenAPI coverage measured and ratcheted | done | `src/contract-coverage.test.ts`, `contracts/coverage-floor.json` |
| B | Legacy bulk stock imports and reversal journalled; company stamped on ledger and batch | done | `lib/import-journal-sync.ts`, `import-journal-sync.postgres.test.ts` (fixed a real tenant bug: a non-default company's imported stock landed under the default company) |
