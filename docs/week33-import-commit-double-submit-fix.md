# Fix: double-submitting "Confirm N lot rows" could double-post stock

## The bug

Reported from the "Stock update" bulk-import screen: confirming an 8,677-row
opening-stock file produced

```
Cannot move import batch from POSTED to POSTED.
```

## Root cause

`routes/core.ts`'s `commitImportBatchToken` (the handler behind
`POST /imports/:batchToken/commit`) read the batch, checked its status was
`PREVIEWED`/`VALIDATED`, then did the real work - posting stock movements
via `persistOpeningStockImport`/`persistDailyMovementImport` - and only
*afterwards* called `transitionBatch(batch.id, 'POSTED', ...)`. Nothing
serialized two requests for the same batch: a double-click on "Confirm", or
a client retry after a slow response, sent two concurrent commit requests
that both read the batch as `VALIDATED` before either had transitioned it.
Both passed the status check and both proceeded to post stock. The first to
finish transitioned the batch to `POSTED`; the second's own
`transitionBatch(..., 'POSTED')` call then hit
`import-center.ts`'s `assertValidBatchTransition`, which has no `POSTED ->
POSTED` transition, and threw `InvalidBatchTransitionError` - the raw
message the user saw. The user-visible crash was a symptom; the real bug is
that the second request's posting work (`persistOpeningStockImport`, a raw
Postgres write) had already run before that error surfaced, meaning stock
could be applied twice for the same confirm action.

## The fix

Two layers, matching this repo's existing patterns:

1. **Serialize commits per batch.** `routes/core.ts` now wraps the whole
   `commitImportBatchToken` call in `withDistributedLock` (`lib/
   distributed-lock.ts`'s Postgres advisory lock, already used by
   `worker.ts`'s boot sweep), keyed by `import-batch-commit:<batchToken>`.
   A concurrent second request that can't acquire the lock gets an
   immediate `409 { message: "This import is already being committed by
   another request..." }` instead of racing the first request's posting
   work. In memory-test mode (`databaseEnabled === false`) the lock helper
   already no-ops to plain execution, so this adds no behavior change
   there.
2. **Make `transitionBatch` itself a compare-and-swap**, as defense in
   depth for any other caller that isn't behind the new lock (or a future
   one that forgets to be). `import-batch-store.ts`'s `transitionBatch` now
   applies the DB write as `prisma.importBatch.updateMany({ where: { id,
   status: current.status }, ... })` (an atomic optimistic-concurrency
   check) instead of an unconditional `update`; the memory-mode branch does
   the equivalent compare-and-swap against the in-memory map. If the
   precondition status no longer holds, it throws a new
   `ConcurrentBatchTransitionError` (`import-center.ts`) instead of letting
   a stale caller either silently overwrite another request's result or
   surface the confusing `InvalidBatchTransitionError`. The commit route
   catches this and returns a clean `409` instead of a raw error.

## Testing

`src/lib/import-batch-store.test.ts` adds a new memory-mode test: fires two
concurrent `transitionBatch(batch.id, 'POSTED', ...)` calls (via
`Promise.allSettled`, a genuine race, not a sequential simulation) against
the same `VALIDATED` batch and asserts exactly one wins and the other
rejects with `ConcurrentBatchTransitionError` - proving the batch is never
posted twice and the loser gets a distinguishable, catchable error. Full
`npm test`: 566 passing, 0 failing (671 total, 105 correctly skipped
DB-only tests). `architecture-lint`: 0 new violations (baseline
regenerated only for line-number shifts from this edit - the same four
pre-existing `unscoped-tenant-query` call sites in `import-batch-store.ts`,
unchanged in substance). `contract:validate`/`contract:check-drift`: both
pass (this fix touches no route contract).

## What's unaffected

This only changes how a *second, racing* commit request for the same batch
is handled - a single, non-concurrent commit behaves exactly as before. The
underlying posting functions (`persistOpeningStockImport`,
`persistDailyMovementImport`) and their own idempotency/dedupe behavior are
untouched.
