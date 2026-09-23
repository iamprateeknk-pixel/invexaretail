# Transition policy coverage (Week 7)

Week 7 asks for "six transition maps": Transfer, StockCount, PurchaseOrder,
Order, Return, Inspection. Honest status, one row per entity:

| Entity | Transition map | Status | Notes |
|---|---|---|---|
| Transfer | `lib/transfer-lifecycle.ts` (`PATCH_TRANSITIONS`, role+status keyed) | Pre-existing, wrapped | Already a real state machine before this week. `lib/domain-policies.ts`'s `assertValidTransferTransitionAudited` wraps its rejection into the shared `DomainError`/audit-log shape without replacing the existing role-aware logic or its call site in `lib/inventory.ts`. |
| PurchaseOrder | `lib/po-lifecycle.ts` (`MOVES`, plus `checkPoMove`'s richer anyReceived/invoice-status gates) | Pre-existing, left as-is | Already more sophisticated than a bare from→to table (it also blocks e.g. closing a PO with unmatched invoices) and already returns a structured `{ok, message}` at its one call site (`routes/catalog-procurement.ts`'s PATCH status route). Wrapping it in `domain-policies.ts` would have thrown away that richness for no gain; `lib/domain-policies.ts` still exposes `assertValidPurchaseOrderTransition` for any *new* call site that only needs the plain status map. |
| ReturnRequest | `lib/returns-rma.ts` (`TRANSITIONS`, action-keyed via `nextReturnStatus`) | Pre-existing, wrapped | Same story as Transfer: `assertValidReturnTransition` in `domain-policies.ts` wraps it for new call sites; the existing `routes/operations-extension.ts` call sites keep calling `nextReturnStatus` directly. |
| StockCount (review workflow) | `domain-policies.ts` (`COUNT_REVIEW_MOVES`) | **New this week** | `reviewStatus` had no transition table before - `lib/persistence.ts`'s `persistCountReview` only had an optimistic `WHERE reviewStatus = 'PENDING_REVIEW'` claim, which stops two concurrent reviews of the *same* count from both winning but never named which target statuses are legal. Now validated centrally before the transaction opens, with a stable `INVALID_TRANSITION` code and an audit-log row on rejection. |
| Order | `domain-policies.ts` (`ORDER_MOVES`) | **New this week** | `lib/orders.ts` wrote `status` directly at four call sites (reservation-expiry sweep, backorder-fill, fulfillment, cancellation) with no shared legality table - each site had its own ad hoc `if (order.status !== 'RESERVED') throw ...`. All four now call `assertValidOrderTransition` first. |
| QcInspection | N/A - documented, not built | **Not a state machine** | The Prisma model has no `.status` field at all: `overallResult` (`PASS`/`FAIL`) is computed once by `lib/qc-inspection.ts`'s `evaluateInspection` at creation and never updated afterward. There is no later transition for a policy to police. `domain-policies.ts` exports `assertInspectionResultImmutable` instead, naming the real invariant (write-once) so a future change that tries to *update* an existing result has something to call rather than a bare `prisma.qcInspection.update`. |

## Reservation atomicity (the other half of Week 7's scope)

`lib/reservation.ts` was rewritten this week. The previous version read
`StockLedger` with Prisma's `findUnique`, checked `onHand - reserved >=
quantity` in application code, then wrote a separate `update({ increment
})` - all inside one `$transaction`, which is not the same thing as atomic:
under Postgres's default READ COMMITTED isolation, two concurrent
transactions can each read the same `reserved` value before either commits,
so both can pass the check and both increment - oversubscription. The
`version` column was bumped on write but never compared on read, so it
provided no real protection.

The fix collapses the check and the write into one statement: a single
conditional `UPDATE ... WHERE ("onHand" - reserved) >= quantity`. Postgres
evaluates and applies this under the row's own lock, so there is no
read-decide-write gap for a second concurrent statement to land in. Proven
against real Postgres in `reservation.postgres.test.ts`: two and ten
concurrent reservation attempts against constrained stock, confirming
`reserved` never exceeds `onHand` and exactly the correct number of
attempts succeed (SQL/trace evidence requirement from the guide's
"mandatory verification").

## What is NOT done this week

- PurchaseOrder and Return's richer gates were not touched (see table above
  for why forcing them onto the plain map would be a regression, not an
  improvement).
- The reservation primitive's transactional outbox write
  (`recordOutboxEventInTransaction`) is only wired into
  `reserveStockForTransfer`; the many pre-existing `publishEvent()` call
  sites elsewhere keep their previous post-commit persist. See ADR-006's
  Week 7 addendum.
- `Transfer`/`PurchaseOrder`/`Return`'s existing route-level error responses
  were not retrofitted to the new `{error, code, traceId}` envelope
  end-to-end - only the reservation and the two new (StockCount, Order)
  policies emit it today, plus the last-resort `index.ts` handler that
  surfaces any `DomainError` uniformly regardless of where it was thrown.
