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
Tenant scope stays column-based, but middleware is no longer trusted as the
*only* enforcement point - Week 4 added mandatory `TenantContext`-typed
repositories as the second, structural layer:

- `lib/tenant-context.ts` defines `TenantContext` (`companyId`, `tenantId`,
  `userId`, `role`, optional audited `elevation`) and `requireTenantContext()`,
  which throws rather than returning a context with an empty `companyId` -
  "missing scope must fail closed" is enforced by the type system refusing
  to construct an invalid context, not by every caller remembering to check.
- `lib/repositories/item-repository.ts` is the reference implementation for
  Catalog: every exported function takes a `TenantContext` as its first
  parameter and every query is scoped by `ctx.companyId` in the same
  statement as the lookup (`findFirst({ where: { id, companyId } })`, not
  "check ownership, then query again").
- **Concrete defect this closed**: `lib/item-master-service.ts`'s
  `changeItemStatus`/`deleteItemPermanently` looked an item up by `id`
  alone, with **no ownership check at all** - the only thing preventing
  Tenant B from archiving or permanently deleting Tenant A's item was
  `routes/item-master.ts`'s route-level `itemIdOf()` guard. Any second
  caller of those service functions (there is only one today, but nothing
  stopped a second one) would have inherited the gap silently. Fixed by
  routing the lookup through `assertItemOwnedByTenant()` inside the service
  itself - defense lives at the layer that can't be bypassed by a new route
  forgetting to duplicate the check.
- Verified with real cross-tenant negative tests against Postgres
  (`lib/repositories/item-repository.postgres.test.ts`): Tenant B is
  rejected on read, status-change and delete against a real Tenant A item id
  (not a guessed one - a genuinely valid id, proving id-as-secret is not
  the security boundary), and the identical call succeeds for Tenant A,
  proving the rejection is the tenant check and not an unrelated bug.
- The rest of Catalog (16 other `prisma.item.*` call sites), all of
  Identity, and all of Organization are **not** migrated this week - see
  `docs/tenant-scope-coverage.md` for the full route-to-repository matrix.
  This is the "no large refactor yet" scope discipline applied to a task
  whose full scope is genuinely large; the repository pattern and its lint
  enforcement exist now so each remaining call site is a small, independent
  follow-up instead of a second big-bang migration.

Column-based scope (not Postgres RLS) stays the underlying mechanism, because:
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
(`api/prisma/migrations/20260922123350_init_postgres`). No schema change
this week for the repository work either - `Item.companyId` already existed;
`docs/tenant-scope-coverage.md` flags `Item.code`'s globally-unique
constraint (should likely be `@@unique([companyId, code])`) as an identified
but not-yet-executed follow-up, since fixing it correctly also requires
updating `lib/persistence.ts`'s code-keyed ERP-import upsert in the same
change.

## Compatibility
No API response shape change. `changeItemStatus`/`deleteItemPermanently`
changed their TypeScript signatures (`(ctx: TenantContext, itemId, ...)`
instead of `(itemId, change, actor, companyId)`) - internal refactor, their
one caller (`routes/item-master.ts`) was updated in the same change.

## Rollback
Revert this ADR's commit. `lib/tenant-context.ts` and
`lib/repositories/item-repository.ts` are additive (new files); the
`item-master-service.ts`/`routes/item-master.ts` signature changes revert
cleanly together.

## Consequences (measurable)
- `scripts/architecture-lint.mjs --rule unscoped-tenant-query` (pilot: Item
  model only) flags any new `prisma.item.*` call with no `companyId`/
  `tenantId` within an 8-line window. Baseline: 16 pre-existing unscoped call
  sites (measured for the first time this week, not introduced by it) -
  tracked in `scripts/architecture-lint-baseline.json` and
  `docs/tenant-scope-coverage.md`. The count must not increase; extending
  the rule beyond the `Item` model is a follow-up.
- Two service functions (`changeItemStatus`, `deleteItemPermanently`) moved
  from zero ownership enforcement to fail-closed enforcement, verified by
  4 passing negative cross-tenant integration tests against real Postgres.
- Revisit the RLS-vs-column-scope part of this ADR if the connection layer
  changes (e.g. moving to PgBouncer transaction pooling, which would make
  `SET LOCAL`-based RLS viable).
