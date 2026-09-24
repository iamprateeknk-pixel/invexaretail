# Bare-id call-site migration, slice 8: in-memory Transfer/StockCount companyId

## Scope

Continues the remediation past its seventh slice (which closed out every
originally-named model's route-level bare-id call sites). This slice
closes the structural gap Weeks 26-29 each named but left open:
`core.ts`'s in-memory `TransferRecord`/`CountRecord` types (`lib/repository.ts`)
carried no `companyId` field at all, so `core.ts`'s many bare-id
`listTransfers().find(...)`/`listCounts().find(...)` lookups depended
entirely on the separate in-memory location-ownership map (via
`lib/inventory.ts`'s `canAccessLocation`) for tenant isolation, never on
a real field on the record itself.

## Why this is lower severity than slices 1-7, and why it's still worth doing

Unlike `operations-extension.ts`'s permissive `canAccessLocation` (fixed
in Week 27), `core.ts` uses `lib/inventory.ts`'s stricter version, which
calls `companyOwnsLocation(context.companyId, locationId)` and denies
unconditionally on a known mismatch, even for `ADMIN`. This was already
confirmed sound in Week 26's investigation. So this slice is not closing
an active cross-tenant leak the way slices 1-7 were - it's removing a
single point of failure: `core.ts`'s tenant isolation for Transfer/
StockCount currently depends entirely on the in-memory ownership map
being correctly populated for every location, with no independent,
record-level fallback if that map is ever wrong or incomplete (a caveat
this repo's own docs already name as a standing limitation of that map).
Giving the records a real `companyId` field is what makes an independent,
record-level check possible at all, for this or a future slice.

## What changed

- `lib/repository.ts`: `TransferRecord` and `CountRecord` both gained an
  optional `companyId?: string` field.
- Every production call site that creates one of these records now sets
  it, threading the same `companyId` value each call site's own
  `req.companyId ?? DEFAULT_COMPANY_ID` (routes) or `cmd.companyId`
  (`transfer-command-service.ts`) already uses for the real Postgres
  write right next to it:
  - `routes/core.ts`'s `POST /replenishment-actions/transfer` (the
    replenishment-recommendation transfer).
  - `routes/core.ts`'s `POST /transfers/import/commit` (the bulk
    transfer-file import).
  - `lib/transfer-command-service.ts`'s `createTransfer` (the primary
    `POST /transfers` path, Week 8's first bounded-context extraction).
  - `routes/core.ts`'s `commitLotCount` (used by every stock-count
    submission route), via its existing `args.companyId` parameter.
- Functions that mutate a transfer in place after creation
  (`updateTransferStatus`, `setTransferLogistics`) were checked and
  already preserve the field unchanged (they only ever assign specific
  properties, never reconstruct the record), so no further change was
  needed there.

## What's deliberately unchanged

- `core.ts`'s ~17 `listTransfers().find(...)`/`listCounts().find(...)`
  bare-id lookups themselves are not being converted to filter by
  `companyId` in this slice. Each already sits behind the strict,
  already-company-aware `canAccessLocation`, so adding a redundant
  `record.companyId === context.companyId` check to all ~17 sites now
  would be defense-in-depth on top of an already-sound check, not a fix
  for a live gap - a larger, lower-value diff than this slice's actual
  goal (making the field exist and be populated at all). It's the natural
  next increment if a future slice wants that second layer.
- No schema/migration change: these are purely in-memory (`lib/repository.ts`)
  types, not Prisma models - there is no Postgres column to add.

## Testing

`src/lib/repository.test.ts` gained a unit test proving `companyId`
round-trips through both `createTransferRecord`/`listTransfers()` and
`createCountRecord`/`listCounts()` - exactly what every production call
site listed above now relies on. No new Postgres integration test was
needed: this change touches only the in-memory mirror, not a Prisma
model, so there's nothing database-specific to prove.

Full `npm test`: 562 passing (the one new test), 0 failing. All 35
existing Postgres integration tests across the prior seven slices were
re-run together and still pass unchanged. `architecture-lint`: 0 new
violations (this slice touches no `prisma.*` call). `contract:validate`/
`contract:check-drift` both pass.

## What's still pending

Auditing whether the in-memory location-ownership map itself
(`lib/saas/tenant-scope.ts`) is reliably populated for every
location-creation path in the codebase remains the standing follow-up
named since Week 27 - this slice makes that audit's eventual fix easier
(a record-level `companyId` check could stand in for, or backstop, the
map-based one) but does not perform the audit itself. Widening past the
originally-named models - `lib/orders.ts`, `lib/persistence.ts`,
import-lifecycle internals, and the `unscoped-tenant-query` lint rule's
`TENANT_SCOPED_MODELS` list versus the full `OPERATIONAL_TENANT_TABLES` -
remains net-new scope beyond this remediation's original charter.
