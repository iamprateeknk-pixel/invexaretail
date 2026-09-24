# Week 11: Staged import lifecycle (staging, commit, reverse)

The guide's Required delivery package names six items (Import wizard,
Staging/commit worker, Golden datasets, Failure export, Reverse/replay
proof, Import runbook). Honest split below: the backend state machine,
worker, failure export, reverse, and this runbook are shipped and tested
against real Postgres; the import wizard is explicit backlog, not a
shallow stand-in - see "Not done" below.

## Shipped

### State machine

`ImportBatch.status` moves through:

```
DRAFT -> VALIDATED -> QUEUED_FOR_COMMIT -> COMMITTING
      -> COMMITTED | PARTIALLY_COMMITTED | FAILED
      -> REVERSING -> REVERSED
```

- **DRAFT**: rows staged (`createImportBatch`), nothing validated yet.
- **VALIDATED**: every row resolved read-only (`validateImportBatch`) -
  item/lot/branch lookups, quantity/date parsing - with no writes to
  `Item`/`Lot`/stock. Safe to re-run.
- **QUEUED_FOR_COMMIT**: `queueImportBatchForCommit` enforces the
  ALL_OR_NOTHING/PARTIAL_SUCCESS policy (below) *before* any row posts. An
  ALL_OR_NOTHING batch with any invalid row goes straight to **FAILED**
  here - zero rows touched.
- **COMMITTING -> COMMITTED/PARTIALLY_COMMITTED**: `commitImportBatchChunk`
  posts up to one chunk of VALID rows past the batch's checkpoint, called
  repeatedly (by the worker, or `commitImportBatchToCompletion` in tests)
  until no VALID rows remain past the checkpoint. Final status is
  COMMITTED if no row ended INVALID, PARTIALLY_COMMITTED otherwise.
- **REVERSING -> REVERSED**: `reverseImportBatch` walks every COMMITTED row
  with a `movementId` and reverses it.

### Idempotency and crash-safe resumability

Two mechanisms, deliberately layered:

1. **File-level dedupe**: `createImportBatch` computes a SHA-256 checksum
   of the uploaded rows (`lib/import-checksum.ts`) and rejects a byte-
   identical re-upload (same company, same import type, same checksum, not
   a FAILED batch) with `DuplicateFileError` - the route returns the
   existing batch (`200 {batch, duplicate: true}`) instead of creating a
   second one.
2. **Row-level idempotency + checkpoint**: each row's post carries the key
   `import:${batchId}:${rowNumber}` into `postInventoryMovement` (Week 6's
   canonical service, which itself de-dupes on that key). After each row,
   `ImportBatch.checkpointRowNumber` is advanced to that row's number. A
   crash between calls to `commitImportBatchChunk` loses at most the
   in-flight row: on resume, the query `status = VALID AND rowNumber >
   checkpointRowNumber` never re-selects an already-committed row, and even
   if it did, the idempotency key would make the re-post a no-op. Proven in
   `import-commit-service.postgres.test.ts` by calling
   `commitImportBatchChunk` with `chunkSize: 1` twice, then completing -
   the ledger reflects each row exactly once.

### Business rules (`lib/import-business-rules.ts`)

- **Purchases post at Head Office** (`HO_LOCATION_NAME = 'HO Basni'`),
  regardless of any branch field the row carries. Missing HO location
  configuration is a hard, structured error (`HoLocationNotConfiguredError`
  / `HO_LOCATION_NOT_CONFIGURED`), not a silent fallback.
- **Sales and sales returns route by the row's own Branch Name**
  (case-insensitive match), scoped to the company. Unknown branch ->
  `BRANCH_NOT_FOUND`.
- **Lot identity is `(itemId, lotNo)`**, already a DB `@@unique` constraint
  on `Lot` - `resolveLotForItem` is a plain find-or-create that relies on
  it, catching the `P2002` race from two concurrent commits creating "the
  same" lot and re-reading the winner rather than erroring.
- **Late movement policy**: a row whose `transactionAt` is before its
  location's `SyncCheckpoint.syncedThroughAt` (per import source type) is
  still posted - never silently dropped - but flagged `LATE_MOVEMENT` in
  the row's warnings, and `advanceSyncCheckpoint` only ever moves the
  checkpoint forward (a late row can never regress it).
- **Quantity parsing** (`parseImportQuantity`) is strict: blank, non-
  numeric, or non-finite input is rejected as `INVALID_QUANTITY` rather
  than silently coerced to zero. This is validated `Float` parsing, not a
  true arbitrary-precision `Decimal` parse - the Decimal migration remains
  prepared-but-not-executed per `docs/decimal-migration-plan.md`, unchanged
  this week.

### Commit policy per import type (`IMPORT_TYPE_POLICY`)

| Import type | Policy | Why |
|---|---|---|
| PURCHASE | PARTIAL_SUCCESS | Rows are independent; one bad row shouldn't block valid siblings. |
| SALES | PARTIAL_SUCCESS | Same reasoning. |
| SALES_RETURN | PARTIAL_SUCCESS | Same reasoning. |
| OPENING_STOCK | ALL_OR_NOTHING | Establishes the *starting* truth for every item/lot/location in the file - a partially-applied opening balance (some items silently starting from zero) is worse than none. |

### Failure export

`exportFailedRows` flattens every INVALID row's `errors` array into one
`{rowNumber, field, code, message}` record per error - the downloadable,
spreadsheet-operator-safe shape the guide asks for. Exposed as `GET
/imports/staged/batches/:id/failures`.

### Reverse

`reverseImportBatch` reverses every COMMITTED row through
`reverseInventoryMovement` (Week 6's equal-and-opposite post, never an edit
to the original row). Tolerates `AlreadyReversedError` on a retried/resumed
reverse call by marking the row REVERSED anyway - calling reverse twice is
itself safe and does not double-reverse stock. Once REVERSED, the state
machine refuses a second `reverseImportBatch` call outright.

### Worker

`lib/import-worker.ts`'s `drainImportCommitsOnce` finds every batch in
`QUEUED_FOR_COMMIT`/`COMMITTING` (across all companies) and advances each
one chunk per tick - `startImportWorker` polls this every 2s, wired into
`worker.ts`'s boot sweep and background loop, same shape as Week 7's
`outbox-worker.ts`. `POST /imports/staged/batches/:id/commit` queues the
batch and fires one immediate drain without awaiting it, so a 5,000+ row
commit never holds the HTTP request open - the route returns `202` right
away.

### Tenant scope

`ImportBatch`/`ImportRow` had **no real tenant scoping before this week** -
only a constant `tenantId` field shared across the whole app. Both models
now carry a real `companyId` (migration
`20261001090000_import_lifecycle_tenant_scope`), and every lookup in
`import-commit-service.ts` filters on it. Proven with a real cross-tenant
fixture: Tenant B cannot validate, queue, or reverse Tenant A's batch with
the real id, and the identical call succeeds for Tenant A.

### Testing

`api/src/lib/import-commit-service.postgres.test.ts` (real Postgres,
skipped unless `TEST_DATABASE_URL` is set) covers: a basic purchase commit
reconciling to HO Basni; a 5,000-purchase + 5,000-sale golden dataset
reconciling to expected ledger totals at both HO and the branch; duplicate-
file rejection; a simulated worker-crash-and-resume not double-posting;
wrong branch / missing lot / malformed quantity each producing a
structured row error; a late movement posting with a `LATE_MOVEMENT`
warning and the checkpoint never regressing; a partial failure (oversell)
leaving the rest of the chunk committed; reverse netting to zero and being
safe to call twice; and cross-tenant isolation.
`route-auth-coverage.test.ts` additionally proves every `/imports/staged/*`
route rejects a request with no credentials.

## Not done (explicit backlog)

- **No import wizard UI.** `routes/imports.ts` accepts already-parsed JSON
  `rows` in the request body - there is no raw file/CSV upload, no column-
  mapping step, and no frontend for any of this yet. The guide's "Import
  wizard" deliverable is unbuilt; building one honestly needs a column-
  mapping UX decision this week did not make unilaterally.
- **Outbox production delivery is closed.** `worker.ts` now performs a boot
  drain and starts `startOutboxWorker`; persisted events are delivered to
  registered subscribers through `deliverPersistedEvent` without inserting
  a second outbox row.
- **The old `lib/persistence.ts`/`lib/import-reversal.ts` import path is
  untouched.** It still writes to the legacy `InventoryMovement` journal
  directly and does not go through this week's state machine or
  `InventoryPostingService`. No migration of existing import call sites was
  attempted this week - this is a new path for new uploads, not a
  replacement, mirroring how Week 6 left baseline `StockLedger` writers
  documented rather than force-migrated (`docs/inventory-posting-coverage.md`).
- **The contract gap is closed.** `contracts/openapi.json` includes create,
  read, validate, commit, failure-export and reverse operations for staged
  batches; validation, generated-client drift and standalone typecheck pass.
