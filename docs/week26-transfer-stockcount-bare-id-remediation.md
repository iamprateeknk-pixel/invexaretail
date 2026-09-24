# Bare-id call-site migration, slice 4: Transfer and StockCount routes

## Scope

Continues the remediation slices 1-3 (Order, PurchaseOrder, ReturnRequest/
ExceptionCase). This slice: every direct `prisma.transfer.*`/
`prisma.stockCount.*` call site in `routes/operations-extension.ts` and
`routes/catalog-procurement.ts`.

`core.ts` was checked and found to already be sound for these two models:
its `Transfer`/`StockCount` lookups go through the in-memory
`listTransfers()`/`listCounts()` mirrors, gated by `lib/inventory.ts`'s
`canAccessLocation(context, locationId)` - a *different*, stricter
function than `operations-extension.ts`'s own local `canAccessLocation`.
`lib/inventory.ts`'s version calls `companyOwnsLocation(context.companyId,
locationId)` first and denies unconditionally if it fails, even for
`ADMIN`. `operations-extension.ts`'s local version has no such check at
all - `ADMIN`/`ADMIN_USER`/`AUDITOR` bypass it unconditionally, which is
the actual root cause behind every bare-id gap fixed in slices 1-3 and
this one. `core.ts`'s in-memory records also don't carry a `companyId`
field, and giving them one is a larger, separate structural change (the
same "in-memory mirror is not company-partitioned" gap already named in
`docs/tenant-scope-coverage.md`'s Catalog section for `lib/persistence.ts:95`)
- flagged as a new finding below, not attempted here.

## The real vulnerabilities, not just a lint nag

- **`GET /intelligence/:locationId`**: `canAccessLocation` (the permissive,
  operations-extension.ts-local one) let any `ADMIN`/`ADMIN_USER`/`AUDITOR`
  through for *any* `locationId`, including one belonging to a different
  company. The `stockCount.findMany` behind it filtered only by
  `locationId`, not `companyId` - so once past the (broken) location
  check, an admin from company B could pull company A's full recent
  stock-count history (used to compute reorder-recommendation confidence
  and flag anomalies) for any location whose id they had or guessed.
- **`GET /purchase-orders/plan`**: took a `locationId` query param with
  **no ownership check of any kind** - not even the permissive
  role-only check the other routes had. Any admin of any company could
  request another company's location and receive its full reorder plan
  (items, on-hand, open PO lines, incoming transfers, recent sales,
  supplier pricing).
- **`POST /pick-waves/:id/scan`**: `prisma.pickWave.findUnique({ where: {
  id } })` with no company check, then trusted `wave.locationId` for the
  same permissive `canAccessLocation` check above, and looked up every
  `prisma.transfer.findUnique({ where: { id } })` in `wave.transferIds`
  with no company check either. An admin of one company given or guessing
  another company's pick-wave id could walk its transfer lines and bin
  sequence.

## What changed

- `GET /intelligence/:locationId`: `prisma.stockCount.findMany`'s `where`
  gained `companyId: req.companyId ?? DEFAULT_COMPANY_ID`. The permissive
  location check itself is untouched (fixing it is a bigger, cross-cutting
  change - see below) but the underlying data query no longer trusts it:
  a cross-tenant admin now gets a 200 with the reorder rule visible (rules
  aren't yet company-scoped either - a further finding) but zero stock-count
  history behind it, collapsing `confidence` to `LOW` instead of reflecting
  another company's real variance data.
- `GET /purchase-orders/plan`: added an explicit
  `prisma.location.findFirst({ where: { id: locationId, companyId:
  req.companyId ?? DEFAULT_COMPANY_ID } })` check before any other query
  runs, returning 404 for a location outside the caller's company - fixing
  the whole handler's leak at its root instead of patching each of its six
  parallel queries individually. The `prisma.transfer.findMany` further
  down also gained a direct `companyId` filter as defense in depth.
- `POST /pick-waves/:id/scan`: `prisma.pickWave.findUnique({ where: { id }
  })` changed to `findFirst({ where: { id, location: { companyId:
  req.companyId ?? DEFAULT_COMPANY_ID } } })`, scoped through the relation
  since `PickWave` itself has no `companyId` column (only the constant
  `tenantId`) - the same relation-scoping pattern Week 24 used for
  `SupplierInvoice`. The per-transfer `prisma.transfer.findUnique` inside
  the loop changed to `findFirst` with a direct `companyId` filter.

## What's deliberately unchanged, and new findings

- `operations-extension.ts`'s own local `canAccessLocation` function still
  grants `ADMIN`/`ADMIN_USER`/`AUDITOR` unconditional access with no
  company check - the same standing gap named in Weeks 23/24. Fixing it
  once, centrally, would close this entire class of bug for every route
  that uses it, rather than patching each downstream query one at a time
  as slices 1-4 have done; that's a bigger, more invasive change (it's
  shared by dozens of routes in this file) and is flagged here as the
  highest-leverage next step, not attempted in this slice.
- `ReorderRule` has no `companyId` column at all (only `tenantId`), so
  `GET /intelligence/:locationId`'s reorder-rule visibility itself is
  still not company-scoped - only the stock-count history behind it is,
  after this slice. A new finding, same shape as Week 24's `Supplier` gap:
  its own tenant-scope migration is a prerequisite for a complete fix.
- `core.ts`'s in-memory `Transfer`/`StockCount` bare-id lookups
  (`listTransfers().find(...)`, `listCounts().find(...)`) are protected by
  a stricter, already company-aware `canAccessLocation`, so they were not
  touched this slice - but the in-memory `TransferRecord`/`CountRecord`
  types themselves carry no `companyId` field, so this protection depends
  entirely on `companyOwnsLocation`'s in-memory ownership map staying
  correct and populated, not on a real column. Flagged as a structural gap
  worth its own investigation, not fixed here.
- `lib/persistence.ts`'s internal `Transfer`/`StockCount` upserts/updates
  and `lib/count-tolerance.ts`'s bare-id `Item`/`StockCount` lookups remain
  baseline, unchanged - already scoped one level up by their callers or
  tracked as lower-priority lib internals per `docs/tenant-scope-coverage.md`.

## Testing

`src/routes/operations-extension-transfer-stockcount.postgres.test.ts`
(real Postgres, 3/3 passing), reusing the `withServer`/`makeFixture`
harness pattern from slices 1-3 (parameterized here over two routers,
`operationsExtensionRouter` and `catalogProcurementRouter`, since this
slice's fixes span both files):

- `GET /intelligence/:locationId`: an admin from another company still
  gets a 200 (the permissive location check is unchanged), but sees
  `confidence: 'LOW'` instead of the real stock-count history's
  `'MEDIUM'`, proving the company data itself is no longer leaked even
  though the endpoint remains reachable.
- `GET /purchase-orders/plan`: 404s for another company's `locationId`;
  the owning company's own plan call is unaffected.
- `POST /pick-waves/:id/scan`: 404s for another company's pick-wave id.

Full `npm test`: 561 passing, 0 failing (3 new tests correctly skipped in
memory mode - `Transfer.companyId`/`StockCount.companyId` are real
Postgres columns). `architecture-lint`: `unscoped-tenant-query` baseline
dropped by the real fixes to `stockCount.findMany`,
`transfer.findFirst`/`findMany` (2 new line-shift-only findings
re-baselined after confirming via `git diff --stat` that only additive/
inline changes were made, no logic removed). `contract:validate`/
`contract:check-drift` both pass.

## What's still pending

The centralized fix for `operations-extension.ts`'s permissive
`canAccessLocation` (the actual root cause behind every slice's findings
so far) remains the highest-leverage next step. `ReorderRule`'s missing
`companyId` column, `core.ts`'s in-memory-only Transfer/StockCount
scoping, `Item`/`Supplier` bare-id call sites, and the remaining
`ExpiryAlert` call sites are still tracked in the `unscoped-tenant-query`
lint baseline.
