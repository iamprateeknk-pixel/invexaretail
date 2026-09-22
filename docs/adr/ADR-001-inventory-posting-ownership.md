# ADR-001: freeze the immutable StockMovement journal + StockBalance projection as the target stock model

## Context
Three tables currently track stock balances, not one:
- `StockMovement` + `StockBalance` (`routes/foundation.ts`'s
  `postStockMovement`): `StockMovement` rows are created, never updated (a
  reversal is a *new* movement tagged `metadata.reversalOf`, never an edit
  to the original), and `StockBalance` is a transactional projection updated
  in the same Prisma transaction. This is exactly the audit's target shape -
  an immutable event journal plus a derived, rebuildable balance projection.
- `StockLedger` (`onHand`/`reserved`/`inTransit`/`quarantine`/`damaged`): a
  *second*, independent balance table, written directly (no journal) from at
  least eight other places - `lib/reservation.ts`, `lib/transfer-receipt.ts`,
  `lib/orders.ts`, `lib/import-reversal.ts`, `lib/exceptions.ts`,
  `lib/persistence.ts`, `routes/catalog-procurement.ts` and
  `routes/operations-extension.ts` - each with its own hand-rolled
  `ON CONFLICT`/upsert idiom (verified while converting these queries off
  MySQL for ADR-004's Postgres migration: every call site had a slightly
  different version of the same upsert).

Two competing systems for "how much stock is at this location" is the
concrete risk this ADR exists to name and stop from growing a third.

## Decision
The target model is the one `postStockMovement` already implements:
**`StockMovement` is the immutable journal of record; `StockBalance` is a
transactional projection derived from it, never hand-edited outside a
posting transaction.** `StockLedger` is the legacy/competing system - it is
not being ripped out this week (that is a large, data-carrying migration,
explicitly out of scope: "do not perform the large refactor or migrations
yet"), but no new code may add a *third* stock-balance table or bypass both
of the existing two with a fresh ad hoc mechanism.

Reconciling `StockLedger` into the `StockMovement`/`StockBalance` model (or
formally deciding `StockLedger` is the one that survives and porting
`postStockMovement`'s callers to it instead) is the follow-up this ADR
schedules but does not resolve. Until that reconciliation ships, all writes
to *either* table must go through their existing designated files (tracked
in AGENTS.md's module-ownership table and `scripts/architecture-lint.mjs`'s
`direct-stock-write` rule) - not a ninth or tenth call site.

## Alternatives considered
- **Declare `StockLedger` canonical instead** (it has far more call sites
  today). Rejected: `StockLedger` has no journal - every write is a direct
  balance mutation with no audit trail of *why* the balance changed, which is
  the opposite of what an inventory system needs for reconciliation, returns,
  and dispute resolution. `postStockMovement`'s journal-plus-projection shape
  is strictly more capable; migrating call sites *to* it is more work than
  the reverse, but it is the correct direction.
- **Leave it distributed, add tests only.** Rejected: race conditions and
  double-posting bugs (the exact class of defect the Week 7 atomicity work
  targets) are structural when every call site re-implements locking.
- **Enforce via a Postgres trigger instead of an application service.**
  Rejected: triggers hide business logic outside the codebase's review path
  (AGENTS.md prohibits state transitions outside the domain policy for the
  same reason) and cannot express the idempotency-key/outbox semantics the
  posting flow needs.

## Migration impact
None this week - no call sites move, no data moves between `StockLedger` and
`StockBalance`. This ADR only freezes the target shape and gives the lint
script something concrete to measure drift against.

## Compatibility
No schema or API change. Existing call sites on both tables keep working
exactly as today.

## Rollback
Nothing to roll back - this is a naming/ownership decision, not a code change.

## Consequences (measurable)
- `scripts/architecture-lint.mjs --rule direct-stock-write` baseline = 8
  `StockLedger`-writing files, captured in
  `scripts/architecture-lint-baseline.json`. Any PR that adds a ninth call
  site to either table outside the AGENTS.md ownership table fails CI.
- Future PRs reconciling `StockLedger` into the journal/projection model
  shrink the baseline; the lint script and this ADR are updated together
  (baseline count must only ever go down, never up, without an ADR
  amendment).
