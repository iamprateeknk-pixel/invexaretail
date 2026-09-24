# Follow-up: real companyId scoping for StockCount and ExpiryAlert

## Context

Completes the tenant-scope migration Weeks 17/19 started and the Transfer
follow-up finished: `PurchaseOrder`, `Order`, `Transfer`, and now
`StockCount` and `ExpiryAlert` all carry a real `companyId` column. This
was the last pair of the original five models named across Weeks 12/15/19/20
as `tenantId`-only.

## What the investigation found

Same "trace the real write, don't trust the obvious function name" lesson
as Transfer:

- **StockCount**: `lib/repository.ts`'s `createCountRecord` is again a
  memory-cache-only write. The real Postgres write is
  `lib/persistence.ts`'s `persistCount` (`prisma.stockCount.upsert`),
  called from `routes/core.ts`'s `commitLotCount` right after the memory
  write - the exact same two-function split as Transfer.
- **ExpiryAlert**: no such indirection - both real write sites
  (`routes/operations-extension.ts`) call `prisma.expiryAlert.upsert`
  directly. One (the expiry write-off route) is a live, request-triggered
  path with `req.companyId` in scope. The other (`syncExpiryAlerts`) is
  **dead code** - grepped and confirmed it is defined but never called
  anywhere in `src/`. Fixed anyway (see below), since leaving dead code
  wrong just means a future caller inherits the bug silently.

## What changed

- `prisma/schema.prisma`: `StockCount.companyId` and `ExpiryAlert.companyId`,
  both real columns. Migration
  `20261027090000_stockcount_expiryalert_company_scope` backfills every
  existing row of both from its own `Location.companyId`.
- `lib/persistence.ts`: `persistCount` takes an optional second
  `companyId` parameter, set on the upsert's `create` data.
- `routes/core.ts`: `commitLotCount`'s `LotCountArgs` gained a `companyId`
  field, threaded through to `persistCount`; both call sites (the regular
  scan-count endpoint and the weight-count loop) pass
  `req.companyId ?? DEFAULT_COMPANY_ID`.
- `routes/operations-extension.ts`: the expiry write-off route's
  `expiryAlert.upsert` create block sets
  `companyId: req.companyId ?? DEFAULT_COMPANY_ID`. `syncExpiryAlerts`
  (the dead-code sync job) sets `companyId: row.companyId` directly - no
  extra join needed, since the `StockLedger` row it's already iterating
  over carries a real `companyId` column of its own (added in an earlier
  week).
- `lib/reporting-repository.ts`: `getStockRiskSummary`'s active-expiry-alert
  count and `getQueueBacklogSummary`'s stock-count queries now filter
  `companyId: ctx.companyId` directly. With both models migrated, the
  `companyLocationIds` join-workaround helper had no remaining callers and
  was removed entirely, along with the `getQueueBacklogSummary` local
  variables that only existed to feed it.

## Testing

Extended `reporting-repository.postgres.test.ts`'s existing fixtures
(stock-risk and queue-backlog tests) to set the new `companyId` explicitly.
Added two dedicated negative tests mirroring the Transfer/Order/PurchaseOrder
pattern: a StockCount and an ExpiryAlert each sharing a Location with
tenant A but whose own `companyId` names tenant B - both count for B, not
A. Full `npm test`: 561 passing, 0 failing. `architecture-lint`: 0 new
violations (line-shift re-baseline from the schema/code edits - the
pre-existing `operations-extension.ts` bare-id findings are unchanged in
substance). `contract:validate`/`contract:check-drift` both pass.

## Not done

- The many bare-id `findUnique`/`update` call sites for `StockCount`/
  `ExpiryAlert` elsewhere in `operations-extension.ts` (e.g. the expiry
  write-off route's own `findUnique` at a different line, or
  `stockCount.findMany` by `locationId` alone) are not migrated to filter
  on the new column - unchanged, still tracked in the Week 15
  `unscoped-tenant-query` lint baseline.
- `syncExpiryAlerts` itself is still dead code (no caller anywhere in
  `src/`) - fixed for correctness in case it's wired up later, but wiring
  it up is out of scope here.

## Where this leaves the tenant-scope migration

All five models named across Weeks 12/15/19/20 (`PurchaseOrder`, `Order`,
`Transfer`, `StockCount`, `ExpiryAlert`) now carry a real `companyId`
column. What remains, per `docs/tenant-scope-coverage.md`, is the read/write
call-site migration for each - the many bare-id lookups across
`routes/operations-extension.ts` and `routes/core.ts` that still don't
filter by the column that now exists. That is the larger, multi-week
god-router remediation both `unscoped-tenant-query` and `bare-status-write`
were built (Weeks 15-16) to make visible, not the schema-level work this
and the preceding weeks closed.
