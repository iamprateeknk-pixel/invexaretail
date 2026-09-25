# Inventory posting coverage (ADR-001 / Week 6)

Honest status: **`InventoryPostingService` is built, tested against real
Postgres, and enforced going forward by `architecture-lint.mjs`'s
`direct-stock-write` rule — but zero pre-existing call sites have been
migrated onto it yet.** This document tracks why, so "0 migrated" reads as a
documented decision rather than an oversight.

## What changed this week

- `api/src/lib/inventory-posting-service.ts` - the canonical posting path:
  `postInventoryMovement()` and `reverseInventoryMovement()`. Writes the
  immutable `StockMovement` journal row and the `StockLedger` projection
  (the table that is actually live and read by the rest of the app — see
  "Correction" below) in one transaction, with optimistic-lock retry,
  idempotency-key deduplication (scoped per `companyId`), a per-location
  negative-stock policy (`BLOCK`/`WARN`/`ALLOW`, default `BLOCK`), an audit
  log entry, and a `DomainEventOutbox` row.
- `api/src/lib/inventory-posting-service.postgres.test.ts` - 8 tests against
  real Postgres: journal+projection created together, idempotent duplicate
  posting, concurrent posting sums correctly, negative stock blocked,
  reversal never edits the original, reversal retries are idempotent,
  lot/location isolation, and tenant isolation of idempotency keys.
- `api/scripts/reconcile-stock-journal.mjs` - sums `StockMovement.qtyDelta`
  per `(itemId, lotId, locationId)` and compares to `StockLedger.onHand`,
  separating `NO_JOURNAL_HISTORY` (expected until a call site migrates) from
  `JOURNAL_MISMATCH` (a real bug; nonzero exit code).
- `architecture-lint.mjs`'s `direct-stock-write` rule now also flags direct
  `StockMovement`/`StockBalance` writes, not just `StockLedger`, outside the
  allowlist below. **Any new file added to `StockLedger`/`StockMovement` write
  access that is not `inventory-posting-service.ts` itself is a lint failure**,
  which is the concrete guardrail requested this week.

## Correction: `routes/foundation.ts` is dead code

The Week 2 pass through this codebase (and ADR-001 as originally written)
assumed `routes/foundation.ts`'s `postStockMovement`, writing to
`StockMovement` + `StockBalance`, was the live/target posting path. It is
not: the file's own header calls itself an unmounted "Phase 1 Prisma
blueprint," it is never imported from `src/index.ts` (`grep -n "foundation"
src/index.ts` returns nothing), and nothing else in the codebase imports
from it either. The table actually written by eight live call sites today —
and read by every screen that shows on-hand quantity — is `StockLedger`.
`InventoryPostingService` therefore targets `StockLedger`, not
`StockBalance`; `StockMovement` is kept as the immutable journal, now
finally written in the same transaction as a live table instead of an
orphaned one. See the ADR-001 Week 6 addendum for the full note.

## Update (guide Week 6 follow-up): on-hand paths migrated

`postInventoryMovementInTransaction(tx, cmd)` joins the canonical posting to a
transaction the caller already owns, so the journal row, `StockLedger`
projection, audit entry and outbox row commit **with** the business state. The
ledger change is one atomic `onHand + delta` upsert (no read-then-write gap).
Every migrated path has a real-Postgres test asserting: one journal row per
logical action, journal sum = on-hand, retry posts nothing more, and a failing
transaction leaves no journal row and no ledger change.

| Path | Movement | Test |
|---|---|---|
| PO receipt (`routes/catalog-procurement.ts`) | `PURCHASE_RECEIPT` - previously the journal row was written *after* commit and its failure swallowed | `catalog-procurement-purchase-orders.postgres.test.ts` |
| Transfer receipt, destination leg (`lib/transfer-receipt.ts`) | `TRANSFER_IN` - previously no journal row at all | `transfer-receipt.postgres.test.ts` |
| Transfer pick-confirm, source leg (`persistConfirmedPickAllocations`) | `TRANSFER_OUT` | `persistence-canonical-posting.postgres.test.ts` |
| Count variance approval (`persistCountReview`) | `COUNT_VARIANCE` | `persistence-canonical-posting.postgres.test.ts` |
| Order fulfilment (`lib/orders.ts`) | `SALES_DEDUCTION` (reservation counter released in the same tx) | `orders-fulfill.postgres.test.ts` |
| Expiry write-off, both routes (`routes/operations-extension.ts`) | `EXPIRY_WRITE_OFF` | `operations-extension-expiry-alerts.postgres.test.ts` |
| Return restock and return disposition (`routes/operations-extension.ts`) | `SALES_RETURN` | none yet (the returns suite covers cross-tenant access only) |
| Job consume (`routes/operations-extension.ts`) | `ADJUSTMENT` - previously decremented on-hand with **no** journal | none yet |
| Exception disposition (`lib/exceptions.ts`) | `ADJUSTMENT` for restock | `exceptions-disposition.postgres.test.ts` |

Quarantine and damaged are separate ledger buckets, not on-hand movements, so
they remain direct writes in the (allowlisted) files above. A quarantine ->
damaged/write-off decision is journalled with **`qtyDelta` 0** and the bucket
move in `metadata` - the old rows recorded `-qty` against quarantine, which made
journal-sum-vs-on-hand reconciliation drift.

**Still baseline (not migrated), and why:** `lib/reservation.ts` and the reserve/
release calls in `lib/persistence.ts` (the `reserved` dimension has no service
command); `lib/import-reversal.ts` and the legacy opening-stock/daily-import
writes in `lib/persistence.ts` (bulk, absolute-set semantics; superseded for new
uploads by the Week 11 staged import, which is canonical); transfer *dispatch*
in-transit bucket. Closing these needs a service command for the `reserved`/
`inTransit`/`quarantine` dimensions - a design decision, not a mechanical move.

## Mutation coverage table

| Call site | Table(s) written | Status | Why |
|---|---|---|---|
| `lib/inventory-posting-service.ts` | `StockLedger`, `StockMovement` | **Canonical** | This week's deliverable. |
| `lib/reservation.ts` | `StockLedger` (reserved qty) | Compatible (allowlisted) | Writes `reserved`, not `onHand` — no delta to post; the service has no reservation command yet. |
| `lib/transfer-receipt.ts` | `StockLedger` | Compatible (allowlisted) | Multi-leg (ship + receive) posting with transfer-specific state; does not map onto a single onHand-delta command without a larger integration. |
| `lib/orders.ts` | `StockLedger` | Compatible (allowlisted) | Order fulfillment path; touches `reserved` and `onHand` together in ways the service's current command shape does not model. |
| `lib/import-reversal.ts` | `StockLedger` | Compatible (allowlisted) | Bulk-import undo; operates on many rows per call, not the service's one-movement-per-call shape. |
| `lib/exceptions.ts` | `StockLedger` (quarantine/damaged) | Compatible (allowlisted) | Quarantine/damaged-quantity transitions are a different state field than `onHand`; out of scope for this week's command shape. |
| `lib/persistence.ts` | `StockLedger` | Compatible (allowlisted) | Generic persistence helper reused by several of the above; migrating it means migrating all of its callers together — future work, not this week's scope. |
| `routes/catalog-procurement.ts` | `StockLedger` | Compatible (allowlisted) | PO receipt posting; similar multi-field shape to transfer receipt. |
| `routes/operations-extension.ts` | `StockLedger` | Compatible (allowlisted) | ADR-005 keeps this file frozen in size; adding a migration here would grow it. |
| `routes/foundation.ts` | `StockMovement`, `StockBalance` | Dead code (allowlisted, not deleted) | Unmounted; kept allowlisted rather than deleted this week since deleting dead code is out of scope for this task. |

"Compatible" here means: these call sites keep working exactly as before —
nothing was broken to ship this service — and they are on the allowlist so
the new lint rule does not fail CI for pre-existing patterns AGENTS.md
already scoped as baseline, not because their direct writes are considered
fine long-term.

## What would it take to migrate one

Each "Compatible" row above writes a *different* piece of state than
`onHand` (reserved quantity, quarantine/damaged buckets, multi-leg
transfer legs) or writes many rows per call. `postInventoryMovement()`'s
command shape (`itemId`, `lotId`, `locationId`, one `qtyDelta`, one
`idempotencyKey`) only covers the simple on-hand-adjustment case. Migrating
`lib/exceptions.ts`, for example, would need either: (a) extending the
service with a second command for quarantine-bucket transitions that also
posts a `StockMovement` row for it, or (b) modeling quarantine as its own
ledger dimension. Either is a real design decision for a future week, not
a drive-by change here.

## Next steps (future weeks)

1. Pick the single highest-value call site (likely `lib/orders.ts`, since
   sales are the most frequent movement type) and design the command
   extension it needs.
2. Extend `reconcile-stock-journal.mjs`'s `NO_JOURNAL_HISTORY` count to a
   CI-gated threshold once enough call sites migrate that a rising count
   would itself be a regression signal.
3. Revisit `routes/foundation.ts`: either delete it (dead code, no
   importers) or intentionally wire it up if a use for the original
   `StockBalance` design re-emerges.
