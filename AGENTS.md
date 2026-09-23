# AGENTS.md

Repository rules for anyone (human or AI) making changes here. Architecture
decisions this file assumes are in `docs/adr/ADR-001` through `ADR-006`;
read those first if a rule below seems arbitrary.

## Repository layout

- `api/` - the deployed backend (Express + Prisma + Postgres). This is the
  only backend Render deploys (see `render.yaml`); it owns the database.
- `web/` - the deployed frontend (Vite).
- `admin-panel/`, `mobile/` - separate deployables, own package.json each.
- `backend/`, `database/` - legacy/unused (pre-`api/` design, MySQL/Sequelize).
  Not deployed by anything in `render.yaml` or `docker-compose.yml`. Do not
  add features here; see Week 18 of the execution guide for the
  archive-after-parity-check plan.
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
| Tenant scope | `api/src/lib/tenant-context.ts` (`TenantContext`, fails closed), `lib/repositories/*.ts` (scoped repositories - `item-repository.ts` is the reference), `lib/saas/tenant-scope.ts` (`enforceOperationalCompanyScope` middleware) | A repository function's *type signature* must require `TenantContext` - middleware alone is not enough (ADR-002). Coverage matrix: `docs/tenant-scope-coverage.md`. |
| Database schema | `api/prisma/schema.prisma` + `api/prisma/migrations/`, `lib/schema-version.ts` (startup verification, read-only) | Only path to schema change (ADR-004). Drift report: `docs/schema-drift-report.md`. Float->Decimal plan (not yet executed): `docs/decimal-migration-plan.md`. |
| Auth / sessions | `api/src/lib/otp-auth.ts` (access tokens, bcrypt), `lib/session-store.ts` (refresh sessions, OTP), `routes/enterprise-auth.ts`, `lib/saas/control-plane.ts` | bcrypt for passwords, `jsonwebtoken` for access tokens, persisted rotating refresh sessions; no custom crypto (ADR-003). |
| Event bus / outbox / API contract | `api/src/lib/event-bus.ts`, `routes/events.ts`, `lib/outbox-worker.ts` (idempotent delivery worker - shipped Week 7) | Durable outbox is the source of truth in database mode (ADR-006). A business write that needs its outbox row atomic with itself uses `recordOutboxEventInTransaction`, not `publishEvent`. |
| Reservation | `api/src/lib/reservation.ts` (`reserveStockForTransfer`, `releaseReservedStock`) | Atomic conditional-`UPDATE` reservation (Week 7) - no read-then-write gap; see `docs/transition-policy-coverage.md`. |
| State transitions / domain policy | `api/src/lib/domain-policies.ts` (central `DomainError`-shaped rejection + audit log), plus the three pre-existing per-entity modules: `lib/transfer-lifecycle.ts`, `lib/po-lifecycle.ts`, `lib/returns-rma.ts` | Six entities named in Week 7 scope (Transfer, StockCount, PurchaseOrder, Order, ReturnRequest, QcInspection); coverage and honest gaps in `docs/transition-policy-coverage.md`. |
| Error catalog | `api/src/lib/errors.ts` (`DomainError`, `ERROR_CODES`, stable `{error, code, traceId}` envelope) | Surfaced uniformly by `src/index.ts`'s last-resort error handler for any `DomainError`, wherever it was thrown (ADR-006 Week 7 addendum). |
| `core.ts`, `operations-extension.ts` | frozen size, no new domains (ADR-005); god-router extraction started Week 8 | 5 routes extracted so far (`routes/transfers.ts`, `routes/branches.ts`) - full accounting and backlog in `docs/route-ownership-matrix.md`. New routes for an already-extracted domain go in its own router, not back into `core.ts`/`operations-extension.ts`. |
| Transfers (extracted) | `api/src/routes/transfers.ts` (thin route), `lib/transfer-command-service.ts` (command service), `lib/repositories/transfer-repository.ts` (`AccessContext`-typed read repository) | First bounded-context extraction (Week 8). Any test harness that mounts `coreRouter` directly and exercises `/transfers` routes must also mount `transfersRouter` (see `transfer-logistics.http.test.ts`, `item-master.http.test.ts`, `route-auth-coverage.test.ts` for the pattern) - those two routes no longer live on `coreRouter`. |
| Branches | `api/src/routes/branches.ts`, `lib/branch-service.ts` | Migrated from the retired `routes/foundation.ts` (Week 8) - DB-only, no in-memory mirror. |
| OpenAPI contract | `api/contracts/openapi.json`, `contracts/generated/` | Covers only extracted routes (Week 8, ADR-006 addendum); grows as each future module is extracted. |
| Route/nav permission gate (web) | `web/src/lib/permissions.js` (`canAccessSection`), consumed by `web/src/lib/workspace.js` (nav visibility) and `web/src/components/workspace/Workspace.jsx` (route render gate) | One source of truth (Week 9) - both the nav and the route guard call the same function. Do not add a second per-page or per-route role table; add the restriction to `NAVIGATION`'s `roles`/`adminOnly` field instead, and both callers pick it up. |
| Shared feedback components (web) | `web/src/components/ui/feedback-states.jsx` (`LoadingState`, `EmptyState`, `ErrorState`, `PermissionDeniedState`, `OfflineState`) | Week 9. New loading/empty/error/permission/offline UI in `web/` uses these, not a new one-off card. |
| Web design tokens | `web/src/index.css` | Single source (Week 9) - color, radius, focus, density (defined, not yet adopted) tokens. Spec: `docs/web/token-specification.md`. `admin-panel/` is not yet consolidated onto this token set (documented gap). |
| Web component test toolchain | `web/test/jsx-loader.mjs`, `web/test/register.mjs` | Week 9 - the first JSX-capable test loader in this repo (esbuild-based), enabling `@testing-library/react` + `jsdom` component tests via `npm run test:components`. |

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
   for `Item` today; extending it to other models is a standing follow-up.
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
   Not machine-checked yet (Week 7 added the modules and wired every known
   write site; a lint rule to catch a *new* bare status write is a standing
   follow-up, the same honest gap as the `unscoped-tenant-query` rule only
   covering `Item` today).

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
