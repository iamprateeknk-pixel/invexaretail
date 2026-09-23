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

## Addendum (Week 6): correction, and the canonical service shipped

**Correction to the Context/Decision above:** `routes/foundation.ts`'s
`postStockMovement` is not live code. Verified this week: its own file
header calls it an unmounted "Phase 1 Prisma blueprint," `grep -n
"foundation" src/index.ts` returns no mount, and no other file imports from
it. `StockBalance` is therefore written by nothing except that dead file -
it has zero real readers or writers in production. The table actually read
by every on-hand-quantity screen, and written by the eight call sites listed
above, is `StockLedger`.

This flips this ADR's decision in one respect: **the canonical journal
target is `StockMovement` (append-only, unchanged) but the canonical
*projection* target is now `StockLedger`, not `StockBalance`.** A posting
service that writes an unread table has no value; `StockBalance` is left in
place (deleting dead code is out of scope for this addendum) but is no
longer treated as the target projection.

**Shipped this week:** `lib/inventory-posting-service.ts`
(`postInventoryMovement`, `reverseInventoryMovement`), writing `StockMovement`
+ `StockLedger` together in one transaction with optimistic-lock retry,
per-company idempotency-key deduplication, a configurable negative-stock
policy, an audit-log entry and a `DomainEventOutbox` row. 8 tests against
real Postgres in `inventory-posting-service.postgres.test.ts` cover
journal/projection consistency, idempotent duplicates, concurrent posting,
negative-stock blocking, non-destructive reversal, idempotent reversal
retries, and both lot/location and tenant isolation.
`scripts/reconcile-stock-journal.mjs` measures how much of `StockLedger` the
journal currently explains.

**Honest state of migration:** none of the eight existing call sites has
been moved onto the new service yet - each writes a different piece of
state (`reserved`, quarantine/damaged buckets, multi-leg transfer legs, or
many rows per call) that the service's current single-`onHand`-delta command
shape does not model. They remain allowlisted in
`scripts/architecture-lint.mjs`'s `direct-stock-write` rule, which this week
was also extended to block *new* direct writes to `StockMovement` and
`StockBalance`, not just `StockLedger`. Full detail and a per-call-site
table: `docs/inventory-posting-coverage.md`.
