# ADR-002: Tenant scope is a column plus enforced middleware, not per-query discipline

## Context
Multi-tenancy is column-based: `companyId` (business/workspace) and
`tenantId` (SaaS control-plane, default `'tenant-invexa'`) live on most
operational tables (`OPERATIONAL_TENANT_TABLES` in
`api/src/lib/foundation-schema.ts` lists 33 of them). Enforcement is
`lib/saas/tenant-scope.ts`'s `enforceOperationalCompanyScope` middleware,
applied per-router in `src/index.ts` and test harnesses
(`app.use('/api/v1', extractToken, enforceOperationalCompanyScope)`). There
is no database-level guarantee (no row-level security, no Postgres policy) -
isolation depends entirely on every query remembering to filter by
`companyId`/`tenantId`, and on every router remembering to mount the
middleware.

## Decision
Tenant scope stays column-based and middleware-enforced (not Postgres RLS)
for this stack, because:
- The app already computes company scope from the JWT once per request
  (`req.user.companyId`) and most queries need it in application logic
  anyway (joins across tenant-scoped and global tables).
- Postgres RLS would require every raw/`$queryRaw` call to run inside a
  session that sets `app.current_company_id`, which the current connection
  pooling model (Prisma driver adapter, pooled `pg.Pool`) does not guarantee
  per-request isolation for without `SET LOCAL` inside every transaction -
  a correctness trap, not a safety net, if adopted half-way.
- `unscoped-tenant-query` becomes a lint-checked prohibited pattern instead:
  cheaper to enforce correctly today, and does not block the Postgres
  migration this week.

## Alternatives considered
- **Postgres Row-Level Security.** Deferred, not rejected outright - worth
  revisiting once every DB access path is confirmed to run through a single
  connection-scoping layer (it currently does not: some raw queries in
  `lib/transfer-receipt.ts` and `lib/import-reversal.ts` run inside
  `prisma.$transaction`, others do not).
- **Schema-per-tenant.** Rejected: this product's tenant count and blueprint
  (single shared operational schema with a `companyId` column, per the
  audit) do not justify the migration/ops cost.

## Migration impact
None from the Postgres switch itself - `companyId`/`tenantId` columns and
their indexes carried over unchanged in the Postgres baseline migration
(`api/prisma/migrations/20260922123350_init_postgres`).

## Compatibility
No API change. No data migration.

## Rollback
N/A - no code changes shipped with this ADR.

## Consequences (measurable)
- `scripts/architecture-lint.mjs --rule unscoped-tenant-query` flags any new
  `prisma.<model>.findMany/findFirst/update/delete` call whose `where` clause
  has no `companyId`/`tenantId` key, for models listed in
  `OPERATIONAL_TENANT_TABLES`. Existing call sites are the baseline; the
  count must not increase.
- Revisit this ADR if the connection layer changes (e.g. moving to PgBouncer
  transaction pooling, which would make `SET LOCAL`-based RLS viable).
