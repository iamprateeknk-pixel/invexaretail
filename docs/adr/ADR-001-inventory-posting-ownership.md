# ADR-001: Inventory posting goes through one service, not scattered writes

## Context
`StockLedger` (onHand/reserved/inTransit/quarantine/damaged) is the single
source of truth for available stock. Today it is written from at least eight
places: `lib/reservation.ts`, `lib/transfer-receipt.ts`, `lib/orders.ts`,
`lib/import-reversal.ts`, `lib/exceptions.ts`, `lib/persistence.ts`,
`routes/catalog-procurement.ts` and `routes/operations-extension.ts`. Only
one file (`routes/foundation.ts`, `postStockMovement`) looks like the
canonical posting entry point the code comments call "InventoryPostingService" -
most other call sites bypass it and write `StockLedger` directly with ad hoc
`ON CONFLICT`/`upsert` logic duplicated per call site (verified while
converting these queries off MySQL in the Postgres migration - each one had
its own slightly different `ON DUPLICATE KEY UPDATE` idiom).

## Decision
All stock-balance mutations must go through a single `InventoryPostingService`
module (`lib/inventory-posting.ts`, to be extracted from `postStockMovement`
in a later week per the blueprint's Module ordering - this ADR freezes the
decision, not the migration). Until that extraction lands, the existing eight
call sites are the tracked baseline (see `scripts/architecture-lint.mjs`);
`direct-stock-write` is a prohibited pattern in `AGENTS.md` for anything new.

## Alternatives considered
- **Leave it distributed, add tests only.** Rejected: race conditions and
  double-posting bugs (the exact class of defect the Week 7 atomicity work
  targets) are structural when every call site re-implements locking.
- **Enforce via a Postgres trigger instead of an application service.**
  Rejected: triggers hide business logic outside the codebase's review path
  (AGENTS.md prohibits state transitions outside the domain policy for the
  same reason) and cannot express the idempotency-key/outbox semantics the
  posting flow needs.

## Migration impact
None this week - no call sites move yet. This ADR only freezes the target
shape and gives the lint script something concrete to measure drift against.
Extraction is scheduled with the Week 7 atomicity work (transaction-safe
reservations) since that is where the eight call sites converge anyway.

## Compatibility
No schema or API change. Existing call sites keep working exactly as today.

## Rollback
Nothing to roll back - this is a naming/ownership decision, not a code change.

## Consequences (measurable)
- `scripts/architecture-lint.mjs --rule direct-stock-write` baseline = 8 files
  captured in `scripts/architecture-lint-baseline.json`. Any PR that adds a
  ninth call site outside that baseline fails CI.
- Future PRs extracting a call site into `InventoryPostingService` shrink the
  baseline; the lint script is updated in the same PR (baseline count must
  only ever go down, never up, without an ADR amendment).
