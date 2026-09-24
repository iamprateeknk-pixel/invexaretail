# Week 17: real companyId scoping for PurchaseOrder

## Scope note

Same situation as Weeks 12-16: no guide text available. This week starts
actually migrating the `tenantId`-only baseline models `docs/week12-
reporting-exception-dashboard.md` and `docs/week15-tenant-scope-lint-
coverage.md` named as backlog - one model at a time, the same
extraction-slice discipline this repo has used for `core.ts`/`operations-
extension.ts` since Week 8. `PurchaseOrder` first: it's the one Week 12
scoped only through a `Location` join in `reporting-repository.ts`, and its
create call sites are both in one file (`routes/catalog-procurement.ts`),
making it the smallest safe first slice.

## What changed

- `prisma/schema.prisma`: `PurchaseOrder.companyId` (real column, not the
  constant `tenantId`), migration `20261015090000_purchase_order_company_scope`
  backfills every existing row from its own `Location.companyId`.
- `routes/catalog-procurement.ts`: both `prisma.purchaseOrder.create` call
  sites now set `companyId: req.companyId ?? DEFAULT_COMPANY_ID` - new
  purchase orders are scoped from creation, not left to the migration's
  default.
- `lib/reporting-repository.ts`: `getQueueBacklogSummary`'s purchase-order
  counts now filter `companyId: ctx.companyId` directly, replacing the
  `companyLocationIds` join workaround for this one model.

## Testing

Extended `reporting-repository.postgres.test.ts`'s existing queue-backlog
fixture to set the new `companyId` field explicitly (it would otherwise
default to `'default-company'` and silently stop matching the test's
per-test tenant). Added a dedicated negative test: a `PurchaseOrder` whose
`locationId` belongs to tenant A but whose own `companyId` names tenant B
counts for B, not A - proving the query is scoped by the real column, not
by the location it happens to share. `npm test`: 561 passing, 0 failing.
`architecture-lint`: 0 new violations (the same pre-existing
`operations-extension.ts`/`catalog-procurement.ts` findings from Weeks
15-16 just shifted line numbers from the schema edit - re-baselined, not
newly introduced).

## Not done

- `PurchaseOrder`'s many `findUnique`/`findMany`/`update` call sites in
  `routes/catalog-procurement.ts` that look up an order by bare id with no
  tenant check (already tracked by Week 15's `unscoped-tenant-query`
  baseline) are not fixed - only the create sites and the one reporting
  query this week actually touched. Adding the column is necessary but not
  sufficient; every read/write site still needs its own review to start
  actually filtering on it.
- `Transfer`, `Order`, `StockCount`, `ExpiryAlert` are still `tenantId`-only
  - `reporting-repository.ts`'s `companyLocationIds` join remains the
  scoping mechanism for those four. `docs/tenant-scope-coverage.md` is the
  tracking doc for finishing this migration model by model.
