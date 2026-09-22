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
  reach a real database - see ADR-003).
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
| Database schema | `api/prisma/schema.prisma` + `api/prisma/migrations/` | Only path to schema change (ADR-003). |
| Auth | `api/src/lib/otp-auth.ts`, `routes/enterprise-auth.ts`, `lib/saas/control-plane.ts` | bcrypt only; no custom crypto (ADR-004). |
| Event bus / outbox | `api/src/lib/event-bus.ts`, `routes/events.ts` | Durable outbox is the source of truth in database mode (ADR-006). |
| `core.ts`, `operations-extension.ts` | frozen size, no new domains (ADR-005) | |

## Required tests

- Any change to `api/src/lib/persistence.ts`, `transfer-receipt.ts`,
  `import-reversal.ts`, or `prisma/schema.prisma` must be exercised against a
  real Postgres instance, not only the default in-memory test mode - set
  `DATABASE_URL`/`TEST_DATABASE_URL` and run the relevant test file directly
  (running the *whole* HTTP test suite against a live database will produce
  false failures from state sharing between unrelated tests - this is a test
  harness limitation, not a signal).
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
   ADR-003 for why the old MySQL self-healing DDL was retired.
5. **Custom crypto.** No hand-rolled hashing/encryption (XOR, custom
   base64 "encryption", `createCipher` without an IV). Passwords: bcrypt via
   `lib/otp-auth.ts` only. Tokens: `jsonwebtoken` only.
6. **Direct push to `main`.** All changes land through a reviewed PR.
7. **State transitions outside the domain policy.** `Transfer`, `Order`,
   `PurchaseOrder`, `StockCount` status changes must go through their
   lifecycle module (e.g. `lib/transfer-lifecycle.ts`), not a bare
   `prisma.transfer.update({ data: { status: ... } })` scattered in a route.

## Architecture decisions

See `docs/adr/`. Six frozen for this week:

- ADR-001: Inventory posting ownership
- ADR-002: Tenant scope (column + middleware, not RLS)
- ADR-003: Database is Postgres; Prisma migrations own schema
- ADR-004: Auth stays JWT + DB-backed RBAC/permissions
- ADR-005: Route composition (no new domains in the two mega-files)
- ADR-006: Event bus/outbox (durable Postgres outbox, not SSE-only)
