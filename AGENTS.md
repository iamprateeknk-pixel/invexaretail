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

Commands from `web/`: `npm run dev`, `npm run build`, `npm test`, `npm run lint`.

## Module ownership

| Area | Owning files | Notes |
|---|---|---|
| Inventory posting | `api/src/lib/persistence.ts`, `lib/transfer-receipt.ts`, `lib/import-reversal.ts`, `routes/foundation.ts` (`postStockMovement`) | Target: one `InventoryPostingService` (ADR-001). Baseline call sites tracked in `scripts/architecture-lint-baseline.json`. |
| Tenant scope | `api/src/lib/saas/tenant-scope.ts` | `enforceOperationalCompanyScope` must be mounted on every router touching `OPERATIONAL_TENANT_TABLES` (ADR-002). |
| Database schema | `api/prisma/schema.prisma` + `api/prisma/migrations/` | Only path to schema change (ADR-004). |
| Auth / sessions | `api/src/lib/otp-auth.ts` (access tokens, bcrypt), `lib/session-store.ts` (refresh sessions, OTP), `routes/enterprise-auth.ts`, `lib/saas/control-plane.ts` | bcrypt for passwords, `jsonwebtoken` for access tokens, persisted rotating refresh sessions; no custom crypto (ADR-003). |
| Event bus / outbox / API contract | `api/src/lib/event-bus.ts`, `routes/events.ts` | Durable outbox is the source of truth in database mode (ADR-006). |
| `core.ts`, `operations-extension.ts` | frozen size, no new domains (ADR-005) | |

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
- New raw SQL (`$queryRaw`/`$executeRaw`) must use Postgres syntax: double-
  quoted exact-case identifiers, `$n` placeholders (or the `queryRaw`/
  `executeRaw` helpers in `lib/db.ts` which translate `?` placeholders for
  you), `ON CONFLICT ... DO UPDATE` not `ON DUPLICATE KEY UPDATE`.
- A migration touching a table that already has data needs an additive-only
  check: no destructive column drops without a documented backfill plan.

## Prohibited patterns

`node scripts/architecture-lint.mjs` checks the machine-checkable ones and
reports existing violations (baseline, does not fail CI) separately from new
violations (fails CI). All of these are prohibited going forward regardless
of whether the linter catches a given instance:

1. **Direct stock writes outside inventory posting.** Any new
   `prisma.stockLedger.{create,update,upsert,updateMany}` or raw SQL touching
   `StockLedger` outside the files in the Module ownership table above.
2. **Unscoped tenant queries.** Any query against a table in
   `OPERATIONAL_TENANT_TABLES` (`api/src/lib/foundation-schema.ts`) whose
   filter does not include `companyId`/`tenantId`.
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
   `PurchaseOrder`, `StockCount` status changes must go through their
   lifecycle module (e.g. `lib/transfer-lifecycle.ts`), not a bare
   `prisma.transfer.update({ data: { status: ... } })` scattered in a route.

## Architecture decisions

See `docs/adr/`. Six frozen in Week 2, one (ADR-003) implemented in Week 3:

- ADR-001: immutable StockMovement journal + StockBalance projection is the
  target stock model; StockLedger is the legacy system being reconciled into it
- ADR-002: tenant scope (column + middleware, not RLS)
- ADR-003: short-lived access tokens + persisted, hashed, rotating refresh
  session families (implemented; see `lib/session-store.ts`)
- ADR-004: database is Postgres; Prisma migrations own schema; startup only
  verifies schema version
- ADR-005: bounded contexts named (Identity, Catalog, Inventory, Warehouse,
  Procurement, Orders, Reporting); no new domains in the two mega-files
- ADR-006: target API contract (versioned OpenAPI, idempotency keys, stable
  error envelope) frozen; the durable Postgres outbox is already real
