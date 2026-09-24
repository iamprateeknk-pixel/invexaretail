# Week 19: real companyId scoping for Order

## Scope note

Same situation as Weeks 12-17 (no guide text available); continues Week
17's tenant-scope migration one model at a time. `Order` next: it's the
model Week 17's own doc named alongside `PurchaseOrder` as the still-
`tenantId`-only baseline, and its create path (`lib/orders.ts`'s
`createOrderInner`/`createOrderWithReservation`) is a single choke point
with exactly three call sites, making it a similarly bounded slice.

## What changed

- `prisma/schema.prisma`: `Order.companyId` (real column). Migration
  `20261022090000_order_company_scope` backfills every existing row from
  its own `fulfillmentLocation.companyId`.
- `lib/orders.ts`: `createOrderInner`'s input type gained an optional
  `companyId`, passed straight to `prisma.order.create`'s data (defaulting
  to `DEFAULT_COMPANY_ID` if the caller doesn't supply one, so memory-mode
  tests and any caller not yet updated keep working).
- All three production call sites now pass it:
  - `index.ts`'s marketplace-connector webhook handler passes
    `connector.tenantId` - the connector record's own field, which despite
    its name (a naming inconsistency already present in the schema, not
    introduced here) is this connector's per-company identifier, defaulting
    to `'default-company'` the same way `companyId` fields elsewhere do.
  - Both `routes/operations-extension.ts` order-creation call sites pass
    `req.companyId ?? DEFAULT_COMPANY_ID`, the same pattern already used
    elsewhere in that file.
- `lib/reporting-repository.ts`: `getQueueBacklogSummary`'s order counts
  now filter `companyId: ctx.companyId` directly, replacing the
  `companyLocationIds` join workaround for this model too.

## Testing

Extended `reporting-repository.postgres.test.ts`'s existing queue-backlog
fixture to set the new `companyId` explicitly on its Order fixtures (same
reason as Week 17 - it would otherwise default and silently stop matching
the test's per-test tenant). Added a dedicated negative test mirroring
Week 17's: an Order whose `fulfillmentLocationId` belongs to tenant A but
whose own `companyId` names tenant B counts for B, not A. `npm test`: 561
passing, 0 failing. `architecture-lint`: 0 new violations (line-shift
re-baseline from the schema edit, not new findings).

## Not done

- The many `prisma.order.findUnique`/`update` call sites elsewhere
  (`routes/operations-extension.ts`) that look an order up by bare id with
  no tenant check are not migrated to filter on the new column - unchanged,
  still tracked in the Week 15 lint baseline.
- `Transfer`, `StockCount`, `ExpiryAlert` remain `tenantId`-only.
  `Transfer`'s own creation path turned out, on inspection, to be more
  tangled than `PurchaseOrder`'s or `Order`'s (its in-memory
  `createTransferRecord` in `lib/repository.ts` doesn't call Prisma at all
  - how a transfer actually reaches `StockLedger` in database mode needs
  its own investigation before a companyId migration there is safe) - left
  for its own dedicated week rather than rushed alongside this one.
