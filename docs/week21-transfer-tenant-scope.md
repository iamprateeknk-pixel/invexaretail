# Follow-up: real companyId scoping for Transfer

## Context

The Week 20 retrospective (`docs/week20-program-retrospective.md`) named
`Transfer` as the model Week 19 deferred rather than rushed, because its
creation path looked, on first inspection, like it never wrote to Postgres
at all (`lib/repository.ts`'s `createTransferRecord` is purely in-memory).
This follow-up investigated that properly and closed the gap.

## What the investigation found

`createTransferRecord` (`lib/repository.ts:358`) is real, always-executed
code, but it is a **memory-cache write**, not the database write. This
codebase's dual-mode pattern for Transfer splits "memory record" and "DB
persist" into two separately-named functions called back-to-back, unlike
`lib/orders.ts`'s single-function `databaseEnabled` branch:

- `lib/transfer-command-service.ts`'s `createTransfer` calls
  `createTransferRecord(...)` (memory, unconditional) at line 110, then
  `await persistTransfer(saved)` (the real Postgres write, guarded by
  `if (!databaseEnabled) return;`) at line 123.
- `persistTransfer` (`lib/persistence.ts:839`) does
  `prisma.transfer.upsert(...)` - this is where a `Transfer` row actually
  reaches Postgres.

Two other genuine creation call sites exist in `routes/core.ts` (a
replenishment-recommendation transfer and a bulk transfer-file import),
both calling `persistTransfer` directly with a fresh id - both hit the
upsert's `create` branch, not `update`.

## What changed

- `prisma/schema.prisma`: `Transfer.companyId`, a real column. Migration
  `20261024090000_transfer_company_scope` backfills every existing row
  from its own `sourceLocation.companyId` (the location that authorized
  the transfer out - the more natural tenant owner than the destination).
- `lib/persistence.ts`: `persistTransfer` takes an optional second
  `companyId` parameter, set on the upsert's `create` data (defaulting to
  `DEFAULT_COMPANY_ID` for any caller not yet updated - the upsert's
  `update` branch is untouched, since an existing transfer's companyId
  never needs to change after creation).
- All three production call sites now pass it:
  `transfer-command-service.ts`'s `createTransfer` passes `cmd.companyId`
  (already resolved per-request and already in scope - it just wasn't
  threaded through before); both `routes/core.ts` call sites pass
  `req.companyId ?? DEFAULT_COMPANY_ID`.
- `lib/reporting-repository.ts`: `getQueueBacklogSummary`'s transfer counts
  filter `companyId: ctx.companyId` directly, replacing the
  `companyLocationIds` join workaround for this model - the last of the
  three models (`PurchaseOrder`, `Order`, `Transfer`) that read used that
  join.

## Testing

Extended `reporting-repository.postgres.test.ts`'s existing queue-backlog
fixture to set the new `companyId` explicitly on its Transfer fixtures
(same reason as Weeks 17/19). Added a dedicated negative test: a Transfer
whose `sourceLocationId` belongs to tenant A but whose own `companyId`
names tenant B counts for B, not A. `npm test`: 561 passing, 0 failing.
`architecture-lint`: 0 new violations (line-shift re-baseline from the
schema/persistence edits, not new findings).

## Not done

- The bare-id `findUnique`/`update` call sites for Transfer elsewhere
  (`routes/operations-extension.ts`, `routes/core.ts`) that look a transfer
  up with no tenant check are not migrated to filter on the new column -
  unchanged, still tracked in the Week 15 lint baseline.
- `StockCount` and `ExpiryAlert` remain `tenantId`-only - the two models
  left of the original five (`PurchaseOrder`, `Order`, `Transfer`,
  `StockCount`, `ExpiryAlert`) named across Weeks 12/15/19/20.
