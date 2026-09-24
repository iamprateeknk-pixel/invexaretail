# AGENTS.md

Repository rules for anyone (human or AI) making changes here. Architecture
decisions this file assumes are in `docs/adr/ADR-001` through `ADR-006`;
read those first if a rule below seems arbitrary.

## Repository layout

- `api/` - the deployed backend (Express + Prisma + Postgres). This is the
  only backend Render deploys (see `render.yaml`); it owns the database.
- `web/` - the deployed frontend (Vite).
- `admin-panel/`, `mobile/` - separate deployables, own package.json each.
- `database/` was the pre-`api/` MySQL/Sequelize schema/migrations half of
  the legacy prototype - already removed (an earlier commit, "Migrate
  Invexa Retail to PostgreSQL and complete Week 1 controls"). `backend/`
  was the other half (an in-memory-only route scaffold, never actually
  wired to Sequelize/MySQL despite the dependency in its `package.json`)
  and is archived as of Week 18 at
  `docs/archive/legacy-backend-prototype/` after a full parity check found
  `api/` has a real, tested, Postgres-backed equivalent for every one of
  its routes - see that directory's `README.md`.
- `api/contracts/` - the versioned OpenAPI contract (Week 8), covering only
  the routes that have been extracted out of the god routers so far (see
  `docs/route-ownership-matrix.md`). `contracts/generated/` is regenerated
  output (`npm run contract:generate`) - never hand-edit it.
- `docs/web/` - the Week 9 UX foundation: role journeys, information
  architecture, token specification, and the component catalog. Read these
  before adding a new page-level pattern in `web/`.

## Commands (run from `api/`)

- `npm install` - installs and runs `prisma generate` + `tsc` build.
- `npm run build` - `prisma generate && tsc`.
- `npm test` - full test suite (`tsx --test`), in-memory mode by default.
- `npm run db:migrate` - `prisma migrate deploy` (the only way schema changes
  reach a real database - see ADR-004).
- `npm run db:seed` - seeds demo data (`prisma/seed.ts`).
- `npm run db:verify` - `scripts/verify-production-db.cjs`, checks the
  target Postgres is reachable and migrated.
- `node scripts/architecture-lint.mjs` - the prohibited-pattern check below.
- `npm run contract:validate` - structurally validates `contracts/openapi.json`.
- `npm run contract:check-drift` - fails if `contracts/generated/` is stale
  relative to `contracts/openapi.json` (CI-gated).
- `npm run contract:generate` - regenerates `contracts/generated/types.ts`
  from the spec; run this and commit the result after editing the spec.
- `npm run contract:typecheck` - compiles `contracts/generated/` standalone.

Commands from `web/`: `npm run dev`, `npm run build`, `npm test` (plain
`.js` hooks/lib/control-plane logic), `npm run test:components` (real
`.jsx` component rendering via `@testing-library/react` + `jsdom` - see
`web/test/jsx-loader.mjs`), `npm run test:all` (both), `npm run lint`.

## Module ownership

| Area | Owning files | Notes |
|---|---|---|
| Inventory posting | `api/src/lib/inventory-posting-service.ts` (canonical - `postInventoryMovement`, `reverseInventoryMovement`), `scripts/reconcile-stock-journal.mjs` (drift check); baseline: `lib/persistence.ts`, `lib/transfer-receipt.ts`, `lib/import-reversal.ts`, `lib/reservation.ts`, `lib/orders.ts`, `lib/exceptions.ts`, `routes/catalog-procurement.ts`, `routes/operations-extension.ts`, `routes/foundation.ts` (dead code, unmounted) | `InventoryPostingService` shipped Week 6 (ADR-001), targets `StockLedger` (the live projection - `StockBalance` has no real readers, see ADR-001 addendum). Baseline files not yet migrated - see `docs/inventory-posting-coverage.md` for the per-file reason. New direct `StockLedger`/`StockMovement`/`StockBalance` writes outside this table fail `architecture-lint.mjs`. |
| Tenant scope | `api/src/lib/tenant-context.ts` (`TenantContext`, fails closed), `lib/repositories/*.ts` (scoped repositories - `item-repository.ts` is the reference), `lib/saas/tenant-scope.ts` (`enforceOperationalCompanyScope` middleware) | A repository function's *type signature* must require `TenantContext` - middleware alone is not enough (ADR-002). Coverage matrix: `docs/tenant-scope-coverage.md`. All five originally-`tenantId`-only models now carry a real `companyId` column: `PurchaseOrder` (Week 17), `Order` (Week 19), `Transfer` (`docs/week21-transfer-tenant-scope.md`), `StockCount`/`ExpiryAlert` (`docs/week22-stockcount-expiryalert-tenant-scope.md`). The read/write call-site migration for each (the many bare-id lookups in `operations-extension.ts`/`core.ts`) is still outstanding - tracked in the `unscoped-tenant-query` lint baseline. |
| Database schema | `api/prisma/schema.prisma` + `api/prisma/migrations/`, `lib/schema-version.ts` (startup verification, read-only) | Only path to schema change (ADR-004). Drift report: `docs/schema-drift-report.md`. Float->Decimal plan (not yet executed): `docs/decimal-migration-plan.md`. |
| Auth / sessions | `api/src/lib/otp-auth.ts` (access tokens, bcrypt), `lib/session-store.ts` (refresh sessions, OTP), `routes/enterprise-auth.ts`, `lib/saas/control-plane.ts` | bcrypt for passwords, `jsonwebtoken` for access tokens, persisted rotating refresh sessions; no custom crypto (ADR-003). |
| Event bus / outbox / API contract | `api/src/lib/event-bus.ts` (`deliverPersistedEvent` broadcasts a delivered event to live SSE subscribers), `routes/events.ts`, `lib/outbox-worker.ts` (idempotent delivery worker - shipped Week 7, wired to `deliverPersistedEvent` in `worker.ts` by a separate line of work merged into this branch - see the note below), `lib/outbox-retention.ts` (`startOutboxRetention`/`pruneOutboxOnce`, Week 14, wired into `worker.ts` alongside it) | Durable outbox is the source of truth in database mode (ADR-006). A business write that needs its outbox row atomic with itself uses `recordOutboxEventInTransaction`, not `publishEvent`. `DomainEventOutbox` rows are pruned after `OUTBOX_RETENTION_DAYS` (7) regardless of delivery outcome (including any that end up POISON), so the table still cannot grow unbounded even with a live consumer attached - see `docs/week14-outbox-retention.md`. Superseding note: Week 14's own investigation concluded there was "no real consumer" to wire the worker to; a separate line of work (merged into `main` and brought into this branch by a later merge) wired it to `deliverPersistedEvent` anyway, and both it and the Week 14 retention sweep now run side by side in `worker.ts` without conflicting. |
| Reservation | `api/src/lib/reservation.ts` (`reserveStockForTransfer`, `releaseReservedStock`) | Atomic conditional-`UPDATE` reservation (Week 7) - no read-then-write gap; see `docs/transition-policy-coverage.md`. |
| State transitions / domain policy | `api/src/lib/domain-policies.ts` (central `DomainError`-shaped rejection + audit log), plus the three pre-existing per-entity modules: `lib/transfer-lifecycle.ts`, `lib/po-lifecycle.ts`, `lib/returns-rma.ts` | Six entities named in Week 7 scope (Transfer, StockCount, PurchaseOrder, Order, ReturnRequest, QcInspection); coverage and honest gaps in `docs/transition-policy-coverage.md`. |
| Error catalog | `api/src/lib/errors.ts` (`DomainError`, `ERROR_CODES`, stable `{error, code, traceId}` envelope) | Surfaced uniformly by `src/index.ts`'s last-resort error handler for any `DomainError`, wherever it was thrown (ADR-006 Week 7 addendum). |
| `core.ts`, `operations-extension.ts` | frozen size, no new domains (ADR-005); god-router extraction started Week 8 | 5 routes extracted so far (`routes/transfers.ts`, `routes/branches.ts`) - full accounting and backlog in `docs/route-ownership-matrix.md`. New routes for an already-extracted domain go in its own router, not back into `core.ts`/`operations-extension.ts`. |
| Transfers (extracted) | `api/src/routes/transfers.ts` (thin route), `lib/transfer-command-service.ts` (command service), `lib/repositories/transfer-repository.ts` (`AccessContext`-typed read repository) | First bounded-context extraction (Week 8). Any test harness that mounts `coreRouter` directly and exercises `/transfers` routes must also mount `transfersRouter` (see `transfer-logistics.http.test.ts`, `item-master.http.test.ts`, `route-auth-coverage.test.ts` for the pattern) - those two routes no longer live on `coreRouter`. |
| Branches | `api/src/routes/branches.ts`, `lib/branch-service.ts` | Migrated from the retired `routes/foundation.ts` (Week 8) - DB-only, no in-memory mirror. |
| OpenAPI contract | `api/contracts/openapi.json`, `contracts/generated/` | Covers only extracted routes (Week 8, ADR-006 addendum); grows as each future module is extracted. As of Week 13, includes the Week 11 `/imports/staged/*` and Week 12 `/reports/*` endpoints (added a version late, closing a gap both weeks' own docs flagged as immediate follow-up). |
| Route/nav permission gate (web) | `web/src/lib/permissions.js` (`canAccessSection`), consumed by `web/src/lib/workspace.js` (nav visibility) and `web/src/components/workspace/Workspace.jsx` (route render gate) | One source of truth (Week 9) - both the nav and the route guard call the same function. Do not add a second per-page or per-route role table; add the restriction to `NAVIGATION`'s `roles`/`adminOnly` field instead, and both callers pick it up. |
| Shared feedback components (web) | `web/src/components/ui/feedback-states.jsx` (`LoadingState`, `EmptyState`, `ErrorState`, `PermissionDeniedState`, `OfflineState`) | Week 9. New loading/empty/error/permission/offline UI in `web/` uses these, not a new one-off card. |
| Web design tokens | `web/src/index.css` | Single source (Week 9) - color, radius, focus, density (defined, not yet adopted) tokens. Spec: `docs/web/token-specification.md`. `admin-panel/` is not yet consolidated onto this token set (documented gap). |
| Web component test toolchain | `web/test/jsx-loader.mjs`, `web/test/register.mjs` | Week 9 - the first JSX-capable test loader in this repo (esbuild-based), enabling `@testing-library/react` + `jsdom` component tests via `npm run test:components`. |
| Item search / stock detail | `api/src/routes/items.ts`, `lib/repositories/item-repository.ts` (`searchItems`, cursor pagination), `lib/stock-detail-service.ts` (`getStockDetail`) | Week 10. Additive to `core.ts`'s existing unpaginated `GET /items` - not a replacement. All mutation (`/adjust`, `/reverse`) goes through `lib/inventory-posting-service.ts` with a required idempotency key. See `docs/week10-item-search-stock-detail.md` for what's shipped vs backlog (the exception-first Dashboard is not built yet). |
| Item search / stock detail (web) | `web/src/hooks/useItemSearch.js`, `useStockDetail.js`, `useInventoryAdjustment.js`, `web/src/components/inventory/*.jsx`, `web/src/components/workspace/pages/ItemStockDetailPage.jsx` | Week 10. Per-screen queries, not wired into `useWorkspaceHydration`'s whole-workspace poll. Registered as the `item-search` `NAVIGATION` entry - goes through `lib/permissions.js` like every other section. |
| Staged import lifecycle | `api/src/routes/imports.ts` (thin route), `lib/import-commit-service.ts` (the state machine - `createImportBatch`, `validateImportBatch`, `queueImportBatchForCommit`, `commitImportBatchChunk`/`commitImportBatchToCompletion`, `reverseImportBatch`, `exportFailedRows`), `lib/import-row-validation.ts` (per-row validation, read-only), `lib/import-business-rules.ts` (HO Basni / branch routing / lot find-or-create / late-movement checkpoint policy), `lib/import-checksum.ts` (file-level dedupe), `lib/import-worker.ts` (`startImportWorker`/`drainImportCommitsOnce`, wired into `worker.ts`'s boot sweep and poll loop) | Week 11. `ImportBatch`/`ImportRow` states: DRAFT -> VALIDATED -> QUEUED_FOR_COMMIT -> COMMITTING -> COMMITTED/PARTIALLY_COMMITTED/FAILED -> REVERSING -> REVERSED. Commit posts exclusively through `lib/inventory-posting-service.ts` (never touches `StockLedger`/`StockMovement` directly), one idempotency key per row (`import:${batchId}:${rowNumber}`), and only ever advances past `ImportBatch.checkpointRowNumber` - a crash/restart resumes from the checkpoint without double-posting. Commit policy is PARTIAL_SUCCESS for PURCHASE/SALES/SALES_RETURN, ALL_OR_NOTHING for OPENING_STOCK (`IMPORT_TYPE_POLICY`). Fixed a real tenant-scoping gap this week: `ImportBatch`/`ImportRow` had only a constant `tenantId` before Week 11, no `companyId` at all - both models now carry `companyId` (migration `20261001090000_import_lifecycle_tenant_scope`). This path is separate from, and does not touch, the older `InventoryMovement`-journal import path in `lib/persistence.ts`/`lib/import-reversal.ts` (still baseline, unmigrated). Gap discovered while wiring `worker.ts` this week (`lib/outbox-worker.ts`'s `startOutboxWorker` was still never called from any production entrypoint) was investigated and, per Week 14's own conclusion at the time, deliberately left unwired for lack of a real consumer - since superseded: a separate line of work wired it to `deliverPersistedEvent` anyway (see the Event bus row above). Accepted, documented gap: `routes/imports.ts` accepts already-parsed JSON rows, not raw file/CSV upload with column mapping - no import-wizard UI was built this week. See `docs/week11-import-staging-commit-reverse.md`. |
| Reporting / exception dashboard | `api/src/routes/reports.ts` (thin route - `GET /reports/dashboard`, `GET /reports/exceptions`), `lib/reporting-repository.ts` (`getDashboardSummary`, `getExceptionQueueSummary`, `listOpenExceptions`, `getStockRiskSummary`, `getQueueBacklogSummary`) | Week 12 - **inferred scope**, not from a verbatim guide task block (the guide document is not checked into this repo and could not be located; this week fills ADR-005's named-but-unbuilt "Reporting" bounded context and Week 10's explicitly-deferred exception-first Dashboard). Defines "at risk"/"SLA" per queue as an explicit, documented decision (`TRANSFER_SLA_HOURS`, `RETURN_SLA_HOURS`, `STOCK_COUNT_REVIEW_SLA_HOURS` constants in `reporting-repository.ts`) rather than leaving it implicit. Every query is real-tenant-scoped: `ExceptionCase` got a genuine `companyId` column this week (it had none at all before - not even the usual constant `tenantId` scoping was safe to rely on for a case with no location); `Transfer`/`PurchaseOrder`/`Order`/`StockCount`/`ExpiryAlert` still only carry the pre-ADR-002 constant `tenantId`, so this module scopes them by joining through each row's `Location` (which does carry a real `companyId`) via `companyLocationIds`. Additive - the pre-existing `/reports/transfer-cycle`, `/reports/count-accuracy`, `/reports/audit-export` (`routes/command-center.ts`) and `/companies/:companyId/dashboard/summary` (`routes/enterprise-analytics.ts`) are untouched. See `docs/week12-reporting-exception-dashboard.md`. |

## Required tests

- Any change to `api/src/lib/persistence.ts`, `transfer-receipt.ts`,
  `import-reversal.ts`, `session-store.ts`, or `prisma/schema.prisma` must be
  exercised against a real Postgres instance, not only the default in-memory
  test mode - set `DATABASE_URL`/`TEST_DATABASE_URL` and run the relevant
  test file directly (running the *whole* HTTP test suite against a live
  database will produce false failures from state sharing between unrelated
  tests - this is a test harness limitation, not a signal).
- Anything touching refresh-token rotation must have a reuse/replay test:
  present an already-rotated token and confirm the whole session family is
  revoked, not just the one token (`lib/session-store.postgres.test.ts` is
  the reference).
- A new or changed tenant-scoped repository function must have a negative
  cross-tenant test: create the row under Tenant A, attempt the operation as
  Tenant B with the *real* id (not a guessed one), confirm it fails closed
  the same way a missing row would, and confirm the identical call succeeds
  for Tenant A (proves the rejection is the tenant check, not an unrelated
  bug) - `lib/repositories/item-repository.postgres.test.ts` is the reference.
- Any change to `lib/schema-version.ts` must be exercised against real
  Postgres and include a test proving it never mutates schema (assert the
  database's table set is identical before and after) -
  `lib/schema-version.postgres.test.ts` is the reference.
- New raw SQL (`$queryRaw`/`$executeRaw`) must use Postgres syntax: double-
  quoted exact-case identifiers, `$n` placeholders (or the `queryRaw`/
  `executeRaw` helpers in `lib/db.ts` which translate `?` placeholders for
  you), `ON CONFLICT ... DO UPDATE` not `ON DUPLICATE KEY UPDATE`.
- A migration touching a table that already has data needs an additive-only
  check: no destructive column drops without a documented backfill plan.
- A change to `lib/inventory-posting-service.ts` must be exercised against
  real Postgres and cover: idempotent duplicate posting, concurrent posting
  to the same item/lot/location (sums correctly, no lost update), negative-
  stock policy enforcement, and reversal (equal-and-opposite movement,
  original row never edited, reversal itself idempotent) -
  `inventory-posting-service.postgres.test.ts` is the reference.
- A change to `lib/reservation.ts` must be exercised against real Postgres
  with a genuine concurrent-request test (`Promise.allSettled` on two or
  more real overlapping calls, not a sequential simulation) proving reserved
  quantity never exceeds on-hand quantity - `reservation.postgres.test.ts`
  is the reference.
- A change to `lib/outbox-worker.ts` must be exercised against real Postgres
  and cover: a simulated crash between claim and delivery does not lose the
  event (it becomes available again once its lease expires), redelivering an
  already-`DELIVERED` row is never attempted, and a handler that always
  fails eventually becomes a visible `POISON` row without blocking other
  pending events in the same batch - `outbox-worker.postgres.test.ts` is the
  reference.
- A new or changed state-transition rule for one of the six domain-policy
  entities must reject its illegal-transition case with a `DomainError`
  carrying a stable `code` and a `traceId`, not a bare `Error` -
  `domain-policies.test.ts` is the reference.
- Extracting a route out of `core.ts`/`operations-extension.ts` into its own
  router must keep it registered in `route-auth-coverage.test.ts`'s router
  list (the no-credentials sweep) and in any `.http.test.ts` file whose
  mini test server mounts `coreRouter` and exercises that route - the
  extraction is not done until the moved route still has authorization and
  parity coverage under its new home, not just a passing build.
  `routes/transfers.test.ts` is the reference for a dedicated
  extraction-specific test file (the stable error envelope on the new
  router, and that it does not widen access beyond the original handler).
- A new module/section added to `web/src/lib/workspace.js`'s `NAVIGATION`
  must work through `lib/permissions.js`'s `canAccessSection` for both nav
  visibility and route access - never add a second, separately maintained
  role table the way the old (removed) `Workspace.jsx` `SECTION_ROLES` map
  did. `lib/permissions.test.js`'s exhaustive role x section matrix is the
  reference; extend it rather than hand-writing a new one-off case.
- A new shared `web/` UI component with interactive elements needs a real
  `@testing-library/react` test (via `npm run test:components`) proving it
  is keyboard-focusable and exposes its state as accessible text/roles, not
  only visually (color/icon alone) - `feedback-states.test.jsx` is the
  reference.
- A new server-paginated list endpoint must have a real Postgres test
  seeding enough rows to exercise more than one page (thousands, not tens),
  proving every row is returned exactly once across pages, in a stable
  order, with no cross-tenant leakage - `item-repository.postgres.test.ts`'s
  5,200-item suite is the reference.
- A new mutating endpoint that posts through
  `lib/inventory-posting-service.ts` must require a caller-supplied
  idempotency key (not derive one server-side from other fields) and have a
  test proving a retried request with the same key returns the original
  result instead of posting again - `items.postgres.test.ts` is the
  reference.
- A change to the staged import lifecycle (`lib/import-commit-service.ts`,
  `import-business-rules.ts`, `import-row-validation.ts`, `import-worker.ts`)
  must be exercised against real Postgres and cover: a 5,000+ row commit
  reconciling to expected ledger totals; a byte-identical re-upload
  returning the existing batch instead of creating a duplicate; a resumed
  commit (simulated crash mid-chunk, called again from the same checkpoint)
  posting each row exactly once; wrong branch name, missing lot, and
  malformed quantity each producing a structured row error instead of a
  crash; a row dated before a location's `SyncCheckpoint` still posting
  (flagged `LATE_MOVEMENT`) without moving the checkpoint backward; a
  mid-commit failure on one row (e.g. a negative-stock block) leaving the
  rest of that chunk's rows unaffected; a reverse netting stock back to zero
  and being safe to call twice; and tenant isolation (a batch created under
  one company must be unreadable, uncommittable and unreversible from
  another) - `import-commit-service.postgres.test.ts` is the reference.
- A change to `lib/reporting-repository.ts` must be exercised against real
  Postgres and cover: exception counts grouped correctly by status and
  priority with a closed/resolved case never counted as breached even past
  its `dueAt`; cursor pagination of open exceptions ordered soonest-due
  first; stock-risk counts (stockout, quarantine, active expiry alert) only
  counting the intended rows; each of the five queue backlogs' pending and
  SLA-breached counts; and tenant isolation across the whole dashboard
  summary (a second company must see zero of the first company's data) -
  `reporting-repository.postgres.test.ts` is the reference.
- A change to `lib/event-bus.ts`'s outbox pruning or `lib/outbox-retention.ts`
  must be exercised against real Postgres and cover: rows older than the
  retention window are removed, rows within it are not, and a client
  reconnecting within the window can still replay every event through
  `durableEventsSince` after a prune has run -
  `outbox-retention.postgres.test.ts` is the reference.
- Any bare-id call-site migration slice (adding a `companyId` filter to a
  `routes/operations-extension.ts` or `routes/core.ts` query that
  previously looked a row up by id alone) must be exercised against real
  Postgres and prove the cross-tenant case resolves 404 (never 403 - a
  403 would confirm the row exists) while the owning tenant's own access
  is unaffected - `operations-extension-orders.postgres.test.ts` is the
  reference, including its reusable `withServer`/`makeFixture` harness
  (mounts the router directly since it applies its own auth middleware;
  seeds a real Postgres `User` row for FKs alongside the in-memory
  enhanced-user record `requireAuth` actually checks).

## Prohibited patterns

`node scripts/architecture-lint.mjs` checks the machine-checkable ones and
reports existing violations (baseline, does not fail CI) separately from new
violations (fails CI). All of these are prohibited going forward regardless
of whether the linter catches a given instance:

1. **Direct stock writes outside inventory posting.** Any new
   `prisma.{stockLedger,stockMovement,stockBalance}.{create,update,upsert,updateMany}`
   or raw SQL touching `StockLedger`/`StockMovement`/`StockBalance` outside
   the files in the Module ownership table above. New code should go through
   `lib/inventory-posting-service.ts` where its command shape fits (a single
   `onHand` delta); see `docs/inventory-posting-coverage.md` for call sites
   whose shape does not fit yet.
2. **Unscoped tenant queries.** Any query against a table in
   `OPERATIONAL_TENANT_TABLES` (`api/src/lib/foundation-schema.ts`) whose
   filter does not include `companyId`/`tenantId`. New code for a model that
   already has a scoped repository (`Item` - `lib/repositories/item-repository.ts`)
   must go through it, not add another direct `prisma.item.*` call next to
   the 16 pre-existing ones tracked in `docs/tenant-scope-coverage.md`.
   `scripts/architecture-lint.mjs`'s `unscoped-tenant-query` rule checks this
   for `TENANT_SCOPED_MODELS` (Week 15 widened this past the original
   Item-only pilot to `item`/`transfer`/`purchaseOrder`/`order`/
   `stockCount`/`returnRequest`/`exceptionCase`/`importBatch`/`importRow`/
   `expiryAlert` - see `docs/week15-tenant-scope-lint-coverage.md`); the
   full `OPERATIONAL_TENANT_TABLES` list is still wider than what's
   checked, a standing follow-up.
3. **Float for money or quantity.** New schema fields for price, cost,
   amount, tax, or similar must not be `Float`. (Existing `Float` quantity/
   money fields are a large pre-existing baseline, not to be "fixed" as a
   drive-by; see the lint output for the current count.)
4. **Runtime DDL.** No `CREATE TABLE`/`ALTER TABLE`/`DROP TABLE` outside
   `prisma/migrations/`. This includes `$executeRaw(Unsafe)` calls - see
   ADR-004 for why the old MySQL self-healing DDL was retired.
5. **Custom crypto.** No hand-rolled hashing/encryption (XOR, custom
   base64 "encryption", `createCipher` without an IV). Passwords: bcrypt via
   `lib/otp-auth.ts` only. Tokens: `jsonwebtoken` only.
6. **Direct push to `main`.** All changes land through a reviewed PR.
7. **State transitions outside the domain policy.** `Transfer`, `Order`,
   `PurchaseOrder`, `StockCount`, `ReturnRequest` status changes must go
   through their lifecycle module (`lib/transfer-lifecycle.ts`,
   `lib/po-lifecycle.ts`, `lib/returns-rma.ts`, or `lib/domain-policies.ts`
   for `StockCount`/`Order`), not a bare
   `prisma.transfer.update({ data: { status: ... } })` scattered in a route.
   Machine-checked since Week 16: `scripts/architecture-lint.mjs`'s
   `bare-status-write` rule catches a *new* bare status write for these
   five models outside their lifecycle module. It found six pre-existing
   ones on introduction (`lib/orders.ts` x3, `lib/persistence.ts`,
   `routes/catalog-procurement.ts`, `routes/operations-extension.ts`) -
   tracked in the lint baseline, not fixed yet - see
   `docs/week16-state-transition-lint.md`.

## Architecture decisions

See `docs/adr/`. Six frozen in Week 2; ADR-003 implemented in Week 3;
ADR-002's repository layer started in Week 4 (`docs/tenant-scope-coverage.md`
tracks how much of it):

- ADR-001: immutable StockMovement journal, now paired with the actually-live
  StockLedger projection (Week 6 correction - StockBalance turned out to be
  unread dead code via unmounted `routes/foundation.ts`); canonical service
  `lib/inventory-posting-service.ts` shipped and tested against real
  Postgres, baseline call sites not yet migrated (`docs/inventory-posting-coverage.md`)
- ADR-002: tenant scope is column + `TenantContext`-typed repositories, not
  middleware alone (Catalog/`Item` is the reference implementation; Identity
  and Organization are not migrated yet)
- ADR-003: short-lived access tokens + persisted, hashed, rotating refresh
  session families (implemented; see `lib/session-store.ts`)
- ADR-004: database is Postgres; Prisma migrations own schema; startup only
  verifies schema version (implemented Week 5 - `lib/schema-version.ts`,
  `docs/schema-drift-report.md`; Float->Decimal conversion prepared but not
  executed - `docs/decimal-migration-plan.md`)
- ADR-005: bounded contexts named (Identity, Catalog, Inventory, Warehouse,
  Procurement, Orders, Reporting); no new domains in the two mega-files
- ADR-006: target API contract (versioned OpenAPI, idempotency keys, stable
  error envelope) frozen; the durable Postgres outbox is already real; Week 7
  addendum ships the idempotent delivery worker (retry/backoff, poison
  events, durable cursor via row status) and the `DomainError` envelope for
  the reservation/transition code (`lib/outbox-worker.ts`, `lib/errors.ts`);
  Week 8 addendum ships the first versioned OpenAPI contract + generated
  typed client for the routes extracted that week, with a CI drift check
  (`api/contracts/`), and records `api/dist` removal as a deferred, reasoned
  exception (Render already builds from source; a second, no-build
  "Hostinger" deploy path in `api/app.js` still hard-requires the committed
  artifact)
- Week 8 also started the `core.ts`/`operations-extension.ts` god-router
  extraction named (but not required complete) by ADR-005: `routes/transfers.ts`
  and `routes/branches.ts` are the first two thin-route modules, each backed
  by its own command service and (for Transfers) a scoped repository. Full
  accounting and backlog: `docs/route-ownership-matrix.md`. The unmounted
  `routes/foundation.ts` is retired - its one unique surface (Branches)
  migrated, everything else superseded or tracked as backlog.
- Week 9 (`web/`, no dedicated ADR - see `docs/web/`): froze the role-first
  UX foundation. Unified nav visibility and route access into one function
  (`lib/permissions.js`), fixing a real gap where 15+ role-restricted
  `NAVIGATION` sections had no route-level guard at all (a direct URL hash
  could open them regardless of the nav hiding the link). Shipped the first
  five shared feedback components, a `:focus-visible` token contract, and
  the repo's first JSX-capable test toolchain (`web/test/jsx-loader.mjs`).
  `SmartDataTable`/`FilterBar`/`Drawer`/`Stepper`/`FormField`/`AppShell` and
  the `admin-panel` token consolidation are explicit backlog, not silently
  dropped - see `docs/web/component-catalog.md`.
- Week 10 (`api/routes/items.ts` + `web/src/components/inventory/`, no
  dedicated ADR - see `docs/week10-item-search-stock-detail.md`): the first
  full-stack vertical slice on the new contract/design-system/canonical-
  stock foundation. Server cursor pagination for item search (proven to
  5,200 items, real Postgres); a stock-detail read model from the canonical
  StockLedger/StockMovement journal; a guided adjustment/reversal wizard
  where every post requires a client-supplied idempotency key and goes
  through `InventoryPostingService` exclusively; per-screen queries (not
  the whole-workspace poll) on the frontend. The exception-first Dashboard
  (SLA/backlog/stock-risk read model) is explicit backlog, not a shallow
  hard-coded stand-in - building one honestly needs a product decision on
  what "at risk" and "SLA" mean per queue, which this week did not make
  unilaterally.
- Week 11 (`api/src/lib/import-*.ts`, `routes/imports.ts`, no dedicated ADR
  - see `docs/week11-import-staging-commit-reverse.md`): the staged import
  lifecycle (DRAFT -> VALIDATED -> QUEUED_FOR_COMMIT -> COMMITTING ->
  COMMITTED/PARTIALLY_COMMITTED/FAILED -> REVERSING -> REVERSED), replacing
  the old single-transaction import path for new uploads. File-checksum
  dedupe up front, per-row idempotency keys plus a durable checkpoint for
  crash-safe resumable commit, an explicit ALL_OR_NOTHING/PARTIAL_SUCCESS
  policy per import type, and the HO-Basni/branch-routing/lot-uniqueness/
  late-movement-checkpoint business rules, all proven against real Postgres
  including a 5,000+ row golden dataset. Fixed a genuine tenant-isolation
  gap found while doing this: `ImportBatch`/`ImportRow` had no `companyId`
  before this week. Two gaps documented rather than fixed: `routes/imports.ts`
  takes already-parsed JSON rows, not a raw file/CSV upload with column
  mapping (no import-wizard UI this week), and Week 7's `startOutboxWorker`
  is still never called from a production entrypoint - discovered while
  wiring this week's own worker into `worker.ts`, out of scope to fix here.
- Week 12 (`api/src/lib/reporting-repository.ts`, `routes/reports.ts`, no
  dedicated ADR - see `docs/week12-reporting-exception-dashboard.md`):
  **inferred scope**, not implementation of a verbatim guide task block -
  the guide document itself is not checked into this repo and a full
  git-history search could not locate it, so this week instead builds what
  ADR-005 already names but leaves unbuilt ("Reporting" bounded context)
  and what Week 10 explicitly deferred (the exception-first Dashboard,
  because "at risk"/"SLA" per queue needed a product decision this repo had
  not made). That decision is made explicitly this week and documented as a
  decision, not a fact: exception breach = past `dueAt` and still open;
  stock risk = stockout, unresolved quarantine, or an active expiry alert
  (no reorder-point/min-stock field exists anywhere in the schema yet, so a
  "will stock out soon" projection is not attempted); queue SLA = each
  domain-policy queue's own due-date field where one exists (Purchase
  Order's `expectedAt`, Order's `estimatedDispatchAt`), or a fixed
  age-since-created threshold where none does (Transfer, ReturnRequest).
  Found and fixed a genuine, complete tenant-isolation gap while building
  this: `ExceptionCase` (the existing cross-module exception inbox) had no
  scoping column at all - not even the usual constant `tenantId` - so any
  existing code querying it already had zero tenant isolation; it now
  carries a real `companyId`. The other queue models this week reads
  (`Transfer`/`PurchaseOrder`/`Order`/`StockCount`/`ExpiryAlert`) still only
  carry the constant `tenantId`, unchanged from before - scoped for this
  week's own queries only, via a join through each row's `Location` (which
  does carry a real `companyId`), not by migrating those five models'
  schemas (out of this week's scope; the same honest gap ADR-002's row
  already names for Identity/Organization).
- Week 13 (`api/contracts/openapi.json`, `contracts/generated/`, no
  dedicated ADR - see `docs/week13-contract-catchup.md`): another inferred-
  scope week (same guide-unavailable situation as Week 12), deliberately
  small - closes the one gap both Week 11 and Week 12 explicitly flagged as
  "immediate follow-up" and left open, rather than adding new speculative
  scope. Adds the six `/imports/staged/*` and two `/reports/*` paths (plus
  their schemas) to the contract, bumped to `2026.13.0`; regenerates
  `contracts/generated/types.ts`; extends `contracts/generated/client.ts`'s
  typed wrapper with `imports.*`/`reports.*`. Every other standing gap named
  in Weeks 11-12 (no import-wizard or dashboard UI, `startOutboxWorker`
  still unwired, the `tenantId`-only baseline on five domain models) is
  untouched, not silently resolved.
- Week 14 (`api/src/lib/event-bus.ts`, `lib/outbox-retention.ts`, no
  dedicated ADR - see `docs/week14-outbox-retention.md`): closes the
  standing `startOutboxWorker`-never-wired gap Weeks 11 and 13 kept
  carrying forward, by actually investigating it instead of deferring it
  again. Finding: there is no real, uninvented consumer for the worker's
  `DeliveryHandler` - SSE (`routes/events.ts`) already reads
  `DomainEventOutbox` directly via `durableEventsSince`, independent of
  delivery status; the separate webhook system carries real entity
  payloads this bare topic/companyId table doesn't have; the audit trail
  covers the same ground, better. Wiring the worker to any of them would
  have been a forced, shallow stand-in. The actual bug, found by tracing
  the table's writers instead of its (absent) readers: every business
  mutation writes a row and, since the worker correctly was never marking
  any DELIVERED, nothing was ever pruning them - unbounded growth in
  production. Fixed with `pruneDomainEventOutbox`/`OUTBOX_RETENTION_DAYS`
  (7 days) and a daily sweep (`lib/outbox-retention.ts`) wired into
  `worker.ts`. `lib/outbox-worker.ts` itself is untouched and still
  correctly unwired - the fully-tested retry/POISON machinery stays ready
  for a real consumer if one appears later.
- Week 15 (`api/scripts/architecture-lint.mjs`, no dedicated ADR - see
  `docs/week15-tenant-scope-lint-coverage.md`): widens the
  `unscoped-tenant-query` lint rule from its Item-only pilot (standing
  follow-up named since Week 4/10) to ten models. Mechanical and
  deliberately small, but its output was not: it surfaced 85 new
  violations, almost all in `routes/operations-extension.ts`, many a
  genuine pattern of trusting a bare `req.params.id` lookup
  (`prisma.order.findUnique({ where: { id } })` and similar) with no
  tenant check anywhere nearby - the same class of gap Week 12 fixed for
  `ExceptionCase`, far more widespread. Not fixed this week (a real
  multi-week remediation, most naturally paired with future
  `operations-extension.ts` extraction slices) - tracked in the lint
  baseline (101 total for this rule) instead of hidden inside a narrower
  rule, per this repo's own "make the gap visible, not silently patched or
  silently ignored" convention for `float-money` and `direct-stock-write`.
- Week 16 (`api/scripts/architecture-lint.mjs`, no dedicated ADR - see
  `docs/week16-state-transition-lint.md`): closes the other named standing
  follow-up from Week 7's prohibited-pattern #7 - a lint rule for bare
  status writes outside the four lifecycle modules
  (`transfer-lifecycle.ts`, `po-lifecycle.ts`, `returns-rma.ts`,
  `domain-policies.ts`). Found six pre-existing bare writes (`lib/orders.ts`
  x3, `lib/persistence.ts` - the latter's `status as any` a visible sign it
  bypasses the lifecycle module's typed checking entirely -
  `routes/catalog-procurement.ts`, `routes/operations-extension.ts`), a
  smaller and more contained finding than Week 15's. Not fixed this week -
  migrating each safely means confirming it doesn't already duplicate
  validation `domain-policies.ts` now provides, a real review, not a
  mechanical fix - tracked in the lint baseline instead. Rules #2 and #7,
  AGENTS.md's only two named-but-unbuilt lint follow-ups, are both
  machine-checked as of this week.
- Week 17 (`api/prisma/schema.prisma`, `routes/catalog-procurement.ts`,
  `lib/reporting-repository.ts`, no dedicated ADR - see
  `docs/week17-purchase-order-tenant-scope.md`): starts actually migrating
  the `tenantId`-only baseline models Weeks 12/15 named as backlog, one
  model at a time - the same extraction-slice discipline used for
  `core.ts`/`operations-extension.ts` since Week 8. `PurchaseOrder` first
  (smallest safe slice: both create call sites live in one file). Real
  `companyId` column, backfilled from each order's own `Location`
  (migration `20261015090000_purchase_order_company_scope`); both create
  sites now set it; `reporting-repository.ts`'s purchase-order queue-
  backlog counts filter on it directly instead of the `Location`-join
  workaround. Proven with a negative test: a PurchaseOrder whose location
  belongs to tenant A but whose own `companyId` names tenant B counts for
  B, not A. Explicitly not done: the column alone doesn't scope
  `catalog-procurement.ts`'s several bare-id `findUnique`/`update` call
  sites (still tracked in the Week 15 lint baseline, unchanged); `Transfer`/
  `Order`/`StockCount`/`ExpiryAlert` remain `tenantId`-only.
- Week 18 (`docs/archive/legacy-backend-prototype/`, no dedicated ADR - see
  `docs/week18-legacy-backend-archive.md`): unlike Weeks 12-17, directly
  named in this repo's own text - the Repository layout section has said
  since before this session began "see Week 18 of the execution guide for
  the archive-after-parity-check plan." `database/` (the MySQL/Sequelize
  half) was already removed by an earlier commit; this archives `backend/`
  (the other half) after confirming it was never actually wired to a
  database at all (an in-memory-only scaffold - `sequelize` was a listed
  dependency but no migration/seed/model file it referenced actually
  existed) and that `api/` has a real, tested, Postgres-backed equivalent
  for every one of its routes. Moved via `git mv` (history preserved) to
  `docs/archive/legacy-backend-prototype/backend/`, with a README recording
  the parity check.
- Week 19 (`api/prisma/schema.prisma`, `lib/orders.ts`, `lib/reporting-
  repository.ts`, no dedicated ADR - see `docs/week19-order-tenant-scope.md`):
  the second slice of the tenant-scope migration Week 17 started. `Order`
  next - its creation path (`lib/orders.ts`'s `createOrderInner`) is a
  single choke point with exactly three call sites, making it similarly
  bounded. Real `companyId` column, backfilled from each order's own
  `fulfillmentLocation` (migration `20261022090000_order_company_scope`);
  all three call sites (the marketplace-connector webhook in `index.ts`,
  two in `routes/operations-extension.ts`) now set it;
  `reporting-repository.ts`'s order queue-backlog counts filter on it
  directly. Investigated `Transfer` as the natural next slice and found it
  more tangled - its in-memory `createTransferRecord` in `lib/repository.ts`
  never calls Prisma at all, so how a transfer actually reaches
  `StockLedger` in database mode needs its own investigation before a
  companyId migration there is safe - deferred rather than rushed.
- Week 20 (no new code, no dedicated ADR - see
  `docs/week20-program-retrospective.md`): the last week of the 20-week
  program. Same guide-unavailable situation as every week since 12; rather
  than invent a final feature under that uncertainty, this week verifies
  the whole repository is actually in the state every prior week's commit
  claimed (`api/` build, full memory-mode test suite, `architecture-lint`,
  contract validate/drift-check, `web/` test suite, and every real-Postgres
  integration suite added since Week 11 - all re-run this week, all green)
  and consolidates 20 weeks of shipped-versus-backlog into one retrospective
  rather than leaving it scattered across 20 per-week docs. Honest
  headline gaps it names: the tenant-scope migration is 2 of 5 models done
  (`Transfer` needs its own investigation first - Week 19 found its
  creation path never calls Prisma at all); `unscoped-tenant-query`'s 99
  and `bare-status-write`'s 6 tracked violations are visible, not fixed;
  `lib/outbox-worker.ts`'s fully-tested retry/POISON machinery has no
  consumer and is effectively dead code; the Float->Decimal migration
  prepared since Week 5 has never been executed; and the execution guide
  document itself was never recovered, so every inferred week from 12
  onward should be checked against the real guide if it's ever found.
- Post-Week-20 follow-up (`api/prisma/schema.prisma`, `lib/persistence.ts`,
  `lib/transfer-command-service.ts`, `routes/core.ts`, no dedicated ADR -
  see `docs/week21-transfer-tenant-scope.md`): resolves the `Transfer`
  investigation Week 19/20 left open. Traced the real write path and found
  it splits across two functions rather than one `databaseEnabled` branch
  like `lib/orders.ts`: `lib/repository.ts`'s `createTransferRecord` is a
  memory-cache write (real but not the database write), while
  `lib/persistence.ts`'s `persistTransfer` (called right after, in the same
  command function) is the actual `prisma.transfer.upsert`. Added a real
  `companyId` column, backfilled from each transfer's `sourceLocation`;
  `persistTransfer` now takes an optional `companyId` set by all three
  production call sites; `reporting-repository.ts`'s transfer counts filter
  on it directly - the last of `PurchaseOrder`/`Order`/`Transfer` off the
  `companyLocationIds` join workaround. Proven with the same negative-test
  pattern as Weeks 17/19. `StockCount` and `ExpiryAlert` remain
  `tenantId`-only.
- Post-Week-20 follow-up 2 (`api/prisma/schema.prisma`,
  `lib/persistence.ts`, `routes/core.ts`, `routes/operations-extension.ts`,
  `lib/reporting-repository.ts`, no dedicated ADR - see
  `docs/week22-stockcount-expiryalert-tenant-scope.md`): closes out the
  tenant-scope migration - `StockCount` and `ExpiryAlert`, the last two of
  the original five `tenantId`-only models. Same "memory-cache write vs.
  real DB write" lesson as Transfer: `lib/repository.ts`'s
  `createCountRecord` is memory-only; the real write is
  `lib/persistence.ts`'s `persistCount`, called from `routes/core.ts`'s
  `commitLotCount` right after it. `ExpiryAlert` has no such indirection -
  one live write site (the expiry write-off route) and one dead-code write
  site (`syncExpiryAlerts`, defined but never called anywhere in `src/` -
  fixed anyway, using `StockLedger.companyId` directly since that row is
  already in scope with no extra join needed). Both models' real
  `companyId` columns are backfilled from their own `Location`;
  `reporting-repository.ts`'s stock-risk and queue-backlog queries for
  both now filter on it directly, and the `companyLocationIds` join
  workaround helper - with no callers left - was removed entirely. All
  five originally-named models now carry a real `companyId` column; the
  bare-id call-site migration for each remains the standing,
  `unscoped-tenant-query`-tracked follow-up.
- Post-Week-20 follow-up 3 (`routes/operations-extension.ts`, no dedicated
  ADR - see `docs/week23-order-bare-id-remediation.md`): the first slice
  of the bare-id call-site remediation itself - every `Order`-model call
  site in `routes/operations-extension.ts` (the order/pack/ship/returns
  routes plus the order-listing endpoint), nine sites fixed,
  `unscoped-tenant-query` baseline dropped from 121 to 112. A real,
  reachable gap, not just a lint nag: `canAccessLocation` grants
  `ADMIN`/`ADMIN_USER`/`AUDITOR` roles access with no company check at
  all, so a cross-tenant order id could pass it once looked up by bare
  id. Each fixed lookup now filters by `companyId` at the query itself, so
  a cross-tenant id resolves the same way a genuinely missing one does
  (404), never revealing existence.
- Post-Week-20 follow-up 4 (`src/routes/operations-extension-orders.postgres.test.ts`,
  no dedicated ADR - closes the honest gap follow-up 3 left open): the
  real-Postgres HTTP test harness for `routes/operations-extension.ts`
  that follow-up 3 said was needed. `withServer`/`makeFixture` mount
  `operationsExtensionRouter` directly (it applies its own
  `extractToken`/`requireAuth` internally), seed two real companies each
  with a Postgres `User` row (for FKs like `Order.createdById`) plus an
  in-memory enhanced-user record (what `requireAuth` actually checks), and
  issue a real JWT per company. Five tests (all passing) prove the Week 23
  fixes actually deny cross-tenant access with 404, not 403 - never
  revealing that another company's row exists - while the owning company's
  own access is unaffected. This harness is meant to be reused, not
  rewritten, by the next slice of the bare-id remediation.
- Post-Week-20 follow-up 5 (`routes/catalog-procurement.ts`, no dedicated
  ADR - see `docs/week24-purchase-order-bare-id-remediation.md`): the
  second slice of the bare-id remediation - every `PurchaseOrder`-model
  call site in `routes/catalog-procurement.ts`. Worse than slice 1's Order
  findings in one respect: `GET /purchase-orders` took `_req` (an unused
  parameter) and returned every company's purchase orders with **no
  tenant filter at all**, not just a bare-id lookup needing one added.
  Also fixed: `PATCH /purchase-orders/:id/status`, `POST
  /purchase-orders/:id/receive`, `POST /purchase-orders/:id/invoices`
  (bare-id `findUnique` -> `findFirst` with `companyId`), and `GET
  /purchase-orders/:id/invoices` (scoped through the `purchaseOrder`
  relation, since `SupplierInvoice` has no `companyId` column of its
  own). `unscoped-tenant-query` baseline: 112 -> 108. Proven with
  `src/routes/catalog-procurement-purchase-orders.postgres.test.ts`
  (4/4 passing), reusing follow-up 4's harness rather than writing a new
  one. New finding, not fixed: `GET /suppliers/:id/score` looks a
  `Supplier` up by bare id, and `Supplier` has no `companyId` column at
  all - its own tenant-scope migration is a prerequisite, out of scope
  here.
- Post-Week-20 follow-up 6 (`routes/operations-extension.ts`,
  `lib/exceptions.ts`, `routes/transfer-logistics.ts`,
  `routes/catalog-procurement.ts`, `routes/core.ts`,
  `lib/qc-inspection.ts`, no dedicated ADR - see
  `docs/week25-returnrequest-exceptioncase-bare-id-remediation.md`): the
  third slice of the bare-id remediation - every `ReturnRequest` call site
  in `routes/operations-extension.ts` (`PATCH /returns/:id/status`, `POST
  /returns/:id/lines/:lineId/disposition`, `PATCH /returns/:id/refund`)
  and its `ExceptionCase` call sites (`GET /exceptions`, `PATCH
  /exceptions/:id`, `POST /exceptions/:id/resolve`). `GET /exceptions` had
  the same complete-list-leak shape as follow-up 5's `GET
  /purchase-orders` finding: a manager/auditor role with no `locationId`
  query param got an unfiltered `{}` scope, seeing every company's
  exception cases. A deeper, quieter bug found while fixing it:
  `lib/exceptions.ts`'s `createExceptionCase()` - the single function
  every case-opening call site in the codebase (receiving discrepancies,
  transfer pack mismatches, pick exceptions, QC failures, and `POST
  /exceptions` itself) funnels through - never set `companyId` on the row
  it created, so every exception case ever opened silently landed under
  the schema's `"default-company"` default regardless of the reporting
  user's real company. Fixed by making `companyId` a required field on
  `CreateExceptionCaseInput` and threading a real value through all eight
  call sites. `unscoped-tenant-query` baseline dropped by 5 real fixes (the
  `GET /exceptions` and `createExceptionCase()` fixes are real but
  invisible to the lint rule's fixed-line-window regex, proven instead by
  this slice's own tests). Proven with
  `src/routes/operations-extension-returns-exceptions.postgres.test.ts`
  (7/7 passing, including a regression test that a newly created exception
  case is stamped with the caller's real companyId, not the schema
  default), reusing follow-up 4's harness.
- Post-Week-20 follow-up 7 (`routes/operations-extension.ts`,
  `routes/catalog-procurement.ts`, no dedicated ADR - see
  `docs/week26-transfer-stockcount-bare-id-remediation.md`): the fourth
  slice of the bare-id remediation - every direct `Transfer`/`StockCount`
  Prisma call site in these two files. Traced the actual root cause behind
  every slice's findings so far while scoping this one: `core.ts`'s
  in-memory Transfer/StockCount lookups are already protected by
  `lib/inventory.ts`'s `canAccessLocation`, a *different*, stricter
  function than `operations-extension.ts`'s own local one of the same
  name - the former checks `companyOwnsLocation` and denies
  unconditionally even for `ADMIN`, the latter grants
  `ADMIN`/`ADMIN_USER`/`AUDITOR` unconditional access with no company
  check at all. Fixed: `GET /intelligence/:locationId` (stock-count
  history no longer leaks to a cross-tenant admin even though the
  permissive location check still lets them reach the endpoint); `GET
  /purchase-orders/plan` (had **no ownership check of any kind** on its
  `locationId` - worse than any prior slice's finding - fixed with an
  explicit `Location` ownership check up front); `POST
  /pick-waves/:id/scan` (`PickWave` scoped through its `location`
  relation, since it has no `companyId` column of its own). Proven with
  `src/routes/operations-extension-transfer-stockcount.postgres.test.ts`
  (3/3 passing). New findings, not fixed: the permissive
  `canAccessLocation` itself (flagged as the highest-leverage next step -
  fixing it once closes this bug class for every route using it, instead
  of patching each downstream query one at a time); `ReorderRule` has no
  `companyId` column at all; `core.ts`'s in-memory Transfer/StockCount
  records carry no `companyId` field, relying entirely on the in-memory
  ownership map rather than a real column.
- Post-Week-20 follow-up 8 (`routes/operations-extension.ts`, no
  dedicated ADR - see `docs/week27-canaccesslocation-centralized-fix.md`):
  the fifth slice of the bare-id remediation, and the first to fix a
  shared root cause instead of another individual query. Fixed
  `operations-extension.ts`'s own local `canAccessLocation` (the
  permissive one, different from `lib/inventory.ts`'s stricter version
  `core.ts` already uses) to deny outright when a location's company
  ownership is known (via the same in-memory
  `ownerOfLocation`/`companyOwnsLocation` map
  `enforceOperationalCompanyScope` already relies on globally) and
  mismatches the caller's company, before its role check runs; a location
  not yet tracked in the map falls through to the original check
  unchanged - the same fail-safe-if-unknown shape already trusted
  elsewhere in this codebase, chosen over a harder check (false-deny risk
  on untracked data) or an async Postgres lookup (would require
  converting ~38 call sites to `await`). One function change closes the
  access gate for every route that calls it; every prior slice's
  query-level `companyId` filter stays in place as an independent second
  layer. Proven with
  `src/routes/operations-extension-canaccesslocation.postgres.test.ts`
  (2/2 passing, including a fail-safe-if-unknown regression test), plus
  all 19 of slices 1-4's existing Postgres tests re-run and still passing
  unchanged.
- Post-Week-20 follow-up 9 (`api/prisma/schema.prisma`,
  `routes/catalog-procurement.ts`, `routes/operations-extension.ts`, no
  dedicated ADR - see `docs/week28-item-supplier-bare-id-remediation.md`):
  the sixth slice of the bare-id remediation - `Item`'s remaining
  route-level call sites, and `Supplier`, which needed its own migration
  first (`20261030090000_supplier_company_scope`) since it had no
  per-company scoping column at all - the same complete gap
  `ExceptionCase` had before Week 12. `GET /suppliers` had the same
  `_req`-unused-parameter, no-filter-of-any-kind shape as Week 24's `GET
  /purchase-orders`. With no `Location` to backfill Supplier from (and
  this very gap having already let a supplier collect purchase orders
  from more than one company), every existing row defaults to
  `'default-company'`, the same fallback this migration series already
  uses when no better source exists. Also fixed: `POST /purchase-orders`
  never verified an item id actually resolved to a real item at all,
  only checking `ACTIVE` status for ones that did - an unresolved or
  cross-tenant item id would silently become a real order line; it now
  rejects the request explicitly. Two adjacent findings fixed in the same
  slice: `GET /saved-views/:id/items` had a completely unfiltered
  `item.findMany()` (every company's whole catalog) behind an unscoped
  `SavedView` lookup; `POST /connectors/:id/ingest` had the bare-id gap on
  `MarketplaceConnector` in *both* its in-memory and Postgres lookup paths
  (the in-memory one wins via `??`, so fixing only the Postgres branch
  would have left it open) and on its per-line SKU-to-Item lookup. Proven
  with two new real-Postgres test files (7/7 and 2/2 passing).
- Post-Week-20 follow-up 10 (`api/prisma/schema.prisma`,
  `routes/catalog-procurement.ts`, `routes/operations-extension.ts`, no
  dedicated ADR - see
  `docs/week29-expiryalert-reorderrule-bare-id-remediation.md`): the
  seventh and, for the models named across this remediation, final slice
  - `ExpiryAlert`'s remaining call sites (it already had a real
  `companyId` since Week 22) and `ReorderRule`, which needed its own
  migration first (`20261102090000_reorder_rule_company_scope`,
  backfilled through the rule's own `Location` since, unlike `Supplier`,
  it has one). Worst finding: `PUT /reorder-rules/:itemId` had **no
  location-ownership check of any kind** - any admin of any company could
  set reorder quantities for another company's location and item, a
  cross-tenant write, not just a read leak - fixed with an explicit
  `Location` ownership check before the upsert. Also fixed: `GET
  /reorder-rules` and the reorder-rule queries inside `GET
  /items/:itemId/forecast`/`GET /intelligence/:locationId` (the last
  closing the exact gap Week 26's own writeup named and left open); `PATCH
  /expiry-alerts/:id/status` and `POST /expiry-alerts/:id/write-off`
  gained a direct `companyId` filter, independent of the
  `canAccessLocation` fallback. Proven with two new real-Postgres test
  files (3/3 and 2/2 passing); Week 26's own `GET /intelligence/:locationId`
  test was updated to assert the reorder rule is now invisible
  cross-tenant, not just degraded. With this slice every model named
  across the remediation's seven slices has its route-level bare-id call
  sites fixed - a further slice would be net-new scope (`core.ts`'s
  in-memory Transfer/StockCount records, or widening past
  `unscoped-tenant-query`'s current `TENANT_SCOPED_MODELS` list).
- Post-Week-20 follow-up 11 (`api/src/lib/repository.ts`,
  `routes/core.ts`, `lib/transfer-command-service.ts`, no dedicated ADR -
  see `docs/week30-transfer-count-inmemory-companyid.md`): the eighth
  slice, lower severity than 1-7 since it closes a structural gap rather
  than an active leak - `core.ts` already uses `lib/inventory.ts`'s
  stricter, company-aware `canAccessLocation`, confirmed sound in Week 26.
  `lib/repository.ts`'s in-memory `TransferRecord`/`CountRecord` types
  carried no `companyId` field at all, so `core.ts`'s bare-id lookups
  depended entirely on the in-memory location-ownership map, with no
  independent record-level fallback if that map is ever wrong or
  incomplete. Both types gained an optional `companyId` field, threaded
  from every production creation call site's own already-known
  `companyId` - the same value each already passes to
  `persistTransfer`/`persistCount` for the real Postgres write next to
  it. `core.ts`'s ~17 bare-id lookups themselves are deliberately not
  converted to filter by this field yet, since the check they sit behind
  is already sound; that's the natural next increment for a future
  slice. Proven with a unit test in `src/lib/repository.test.ts`; no
  schema/migration change (these are in-memory types, not Prisma
  models).
- Post-Week-20 follow-up 12 (`api/src/lib/repository.ts`,
  `routes/core.ts`, no dedicated ADR - see
  `docs/week31-core-transfer-count-companyid-scoping.md`): the ninth
  slice, and the "natural next increment" follow-up 11 named. Every one
  of `core.ts`'s ~18 `listTransfers().find(...)`/`listCounts().find(...)`
  lookups converted to two new functions, `findTransferForCompany`/
  `findCountForCompany`, checking the record's own `companyId` directly -
  fail-safe-if-unknown, the same pattern as follow-up 8's centralized
  `canAccessLocation` fix (a record whose `companyId` is known and
  mismatches the caller's is denied; one with no `companyId` yet, from
  before follow-up 11's field existed, falls through unchanged). This is
  an independent second layer alongside the location-ownership check
  these lookups already sit behind, not a fix for an active leak -
  `core.ts`'s Transfer/StockCount handling was already sound per follow-up
  7's investigation. One post-mutation re-fetch was left unconverted,
  safe by construction (re-reads an id already resolved earlier in the
  same request). Proven with a new memory-mode test file (3/3 passing,
  including a fail-safe-if-unknown regression test) - no
  `TEST_DATABASE_URL` needed since these are in-memory records, not a
  Prisma model. With this slice, every model named across the bare-id
  remediation has both its route-level Prisma call sites and its
  in-memory mirror lookups (where one exists) scoped by a real
  `companyId`, independent of the location-ownership map.
- Merge with `main` (34 commits, no dedicated ADR): this branch had
  diverged from `main` by 34 commits of independent work - Cloudflare/
  Railway deploy configuration (`api/railway.worker.json`,
  `web/wrangler.toml`, `docs/deployment-railway-cloudflare.md`), CORS
  origin handling (`lib/cors-origins.ts`), a mobile secure-storage module
  (`mobile/lib/services/secure_store.dart`), a Playwright E2E journey for
  Item Search/Stock Detail (`web/e2e/item-stock-detail.spec.js`,
  `web/playwright.config.js`, `npm run test:e2e`), and a release-evidence
  writeup (`docs/release-evidence/weeks-03-07-09-10-11-completion.md`).
  Nearly every conflict was an add/add on a file both branches had
  independently kept extending from the same older shared ancestor - in
  every one of those, this branch's version was the strict superset (a
  later state of the same evolving file: `AGENTS.md`,
  `docs/tenant-scope-coverage.md`, `api/contracts/openapi.json` and its
  generated client/types, `api/scripts/architecture-lint.mjs` and its
  baseline, `api/prisma/schema.prisma`'s several `companyId` column
  conflicts), so this branch's side was kept in each case. Two conflicts
  were genuine content, not staleness, and were merged rather than picked:
  `docs/week10-item-search-stock-detail.md` and
  `docs/week11-import-staging-commit-reverse.md` took `main`'s wording,
  since it correctly describes state this merge makes true (the E2E
  journey now exists; the outbox worker is now wired - see below).
  `api/src/worker.ts` was a real decision conflict, not a wording one:
  `main`'s separate line of work had actually wired
  `lib/outbox-worker.ts`'s `startOutboxWorker` to a live handler
  (`lib/event-bus.ts`'s `deliverPersistedEvent`, broadcasting to SSE
  subscribers) - superseding Week 14's own documented conclusion that no
  real consumer existed to wire it to. Rather than picking one side, both
  now run together: the worker delivers to live subscribers, and Week
  14's retention sweep still prunes rows past `OUTBOX_RETENTION_DAYS`
  regardless of delivery outcome, so the table still cannot grow
  unbounded even with a consumer now attached - verified there's no
  actual conflict between delivery and pruning (7 days is generous
  headroom for delivery to complete first). `web/package.json`'s two
  conflicts (the `test:e2e` script and `@playwright/test` dependency) were
  both `main`-only additions needed by the E2E spec now merged in;
  `web/package-lock.json` was regenerated via `npm install` rather than
  hand-merged. Full verification after resolving: `api/` build,
  `npm test` (562 passing, 0 failing, matching pre-merge exactly),
  `architecture-lint` (0 new violations), `contract:validate`/
  `contract:check-drift` (both pass), all 35 Postgres integration tests
  across the bare-id remediation's slices (all still passing), and
  `web/`'s `npm test` (107 passing) and `npm run test:components` (18
  passing).
- Post-merge follow-up (`api/src/lib/import-center.ts`,
  `lib/import-batch-store.ts`, `routes/core.ts`, no dedicated ADR - see
  `docs/week33-import-commit-double-submit-fix.md`): fixes a real
  production bug reported via the "Stock update" bulk-import screen - a
  double-click (or client retry) on "Confirm N lot rows" sent two
  concurrent `POST /imports/:batchToken/commit` requests that both read
  the batch as `VALIDATED` before either transitioned it, both posted
  stock (`persistOpeningStockImport`/`persistDailyMovementImport`), and
  the loser's own `transitionBatch(..., 'POSTED')` call then crashed with
  the confusing `Cannot move import batch from POSTED to POSTED` - a
  symptom of the real problem (stock already double-posted by the time
  that error surfaced), not just an ugly message. Fixed with two layers:
  `routes/core.ts` now wraps the whole commit handler in
  `withDistributedLock` (`lib/distributed-lock.ts`'s existing Postgres
  advisory lock, already used by `worker.ts`), keyed per batch, so a
  racing second request gets an immediate `409` before it can post
  anything; and `import-batch-store.ts`'s `transitionBatch` is now itself
  a compare-and-swap (`updateMany` gated on the status read at the start
  of the call, or the memory-mode equivalent) throwing a new
  `ConcurrentBatchTransitionError` if the batch moved under it, as
  defense in depth for any other caller. Proven with a new memory-mode
  test firing two genuinely concurrent `transitionBatch` calls via
  `Promise.allSettled` and asserting exactly one wins. `npm test`: 566
  passing, 0 failing; `architecture-lint`: 0 new violations (baseline
  regenerated only for line-number shifts, same four pre-existing
  `import-batch-store.ts` call sites); `contract:validate`/
  `contract:check-drift`: both pass.