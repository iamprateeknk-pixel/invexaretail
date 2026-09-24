# Bare-id call-site migration, slice 9: core.ts's Transfer/StockCount lookups

## Scope

Slice 8 (`docs/week30-transfer-count-inmemory-companyid.md`) gave the
in-memory `TransferRecord`/`CountRecord` types a real `companyId` field,
threaded from every production creation call site, but deliberately left
`core.ts`'s ~18 bare-id `listTransfers().find(...)`/`listCounts().find(...)`
lookups unconverted - each already sat behind `lib/inventory.ts`'s
company-aware `canAccessLocation` (confirmed sound in Week 26), so there
was no active leak to close, only a single point of failure to remove.
This slice is that "natural next increment" Week 30 named: converting
every one of those lookups to check the record's own `companyId`
directly, independent of the location-ownership check.

## The fix

Two new functions in `lib/repository.ts`, next to `listTransfers`/
`listCounts`:

```ts
export function findTransferForCompany(id: string, companyId: string): TransferRecord | undefined {
  const transfer = transfers.find((record) => record.id === id);
  if (!transfer) return undefined;
  if (transfer.companyId && transfer.companyId !== companyId) return undefined;
  return { ...transfer, lines: transfer.lines.map((line) => ({ ...line })) };
}
```

(`findCountForCompany` is the same shape for `CountRecord`.) Both are
fail-safe-if-unknown, the same pattern as Week 27's centralized
`canAccessLocation` fix: a record whose `companyId` is set and mismatches
the caller's is denied outright; a record with no `companyId` yet
(created before Week 30's field existed, or by some path this migration
hasn't reached) falls through unchanged. This was the deliberate choice
over a strict equality check, which would risk a false 404 for any
pre-existing in-memory record that predates the field.

Every one of `core.ts`'s ~18 entry-point `listTransfers().find(...)`/
`listCounts().find(...)` calls was converted to
`findTransferForCompany(id, req.companyId ?? DEFAULT_COMPANY_ID)` /
`findCountForCompany(...)`. One re-fetch (`POST
/transfers/:transferId/receive`'s post-mutation `listTransfers().find(...)`
to build the response) was left unchanged - it re-reads a `transferId`
already resolved through a fixed lookup earlier in the same request,
safe by construction, the same reasoning used throughout this
remediation for a same-handler re-fetch.

## What's deliberately unchanged

- The location-ownership check (`canAccessLocation`) each of these
  lookups already sits behind is untouched - this is an independent
  second layer, not a replacement. Neither check alone was ever wrong;
  they now cover each other's blind spots (the location check protects
  against an id whose location isn't tracked in the ownership map yet;
  the companyId check protects against a record whose location happens
  to be misregistered or shared).
- No Prisma/schema change - `TransferRecord`/`CountRecord` are in-memory
  types, and their `companyId` field was already added in Slice 8.

## Testing

`src/routes/core-transfer-count-companyid.test.ts` (memory-mode, no
`TEST_DATABASE_URL` needed - these are in-memory records, not a Prisma
model), 3/3 passing:

- `GET /picker/transfers/:transferId`: a transfer stamped with a
  different company's `companyId` resolves 404 for that company's admin,
  even though `ADMIN` has no bypass in `lib/inventory.ts`'s
  `canAccessLocation` - proving the new check is real and independent,
  not redundant with the location check. The real owning company's own
  admin is unaffected.
- `POST /stock-counts/:countId/reconciliation/ack`: the same 404 proof
  for `CountRecord`.
- A transfer created with no `companyId` at all (simulating a
  pre-existing record from before Slice 8) still resolves successfully
  for a legitimate request - the fail-safe-if-unknown regression test.

Full `npm test`: 565 passing (3 new), 0 failing. `architecture-lint`: 0
new violations (this slice touches no `prisma.*` call - `listTransfers`/
`listCounts` are in-memory, not scanned by the `unscoped-tenant-query`
rule). `contract:validate`/`contract:check-drift` both pass. All 35
existing Postgres integration tests across the remediation's prior
slices re-run together and still pass unchanged.

## What's still pending

With this slice, `core.ts`'s Transfer/StockCount bare-id lookups have the
same two-layer protection (location ownership + record companyId) every
other remediated route in this codebase now has. Remaining backlog is
net-new scope beyond this remediation's original charter: auditing
whether the in-memory location-ownership map is reliably populated for
every location-creation path (Week 27's standing follow-up), or widening
past the `unscoped-tenant-query` lint rule's current `TENANT_SCOPED_MODELS`
list toward the full `OPERATIONAL_TENANT_TABLES`.
