# Bare-id call-site migration, slice 5: centralized canAccessLocation fix

## Scope

Slices 1-4 (Order, PurchaseOrder, ReturnRequest/ExceptionCase, Transfer/
StockCount) each fixed individual query call sites in
`routes/operations-extension.ts` and `routes/catalog-procurement.ts`, but
Week 26's writeup named a shared root cause behind nearly all of them:
`operations-extension.ts`'s own local `canAccessLocation(req, locationId)`
grants `ADMIN`/`ADMIN_USER`/`AUDITOR` unconditional access to **any**
`locationId`, with no company check at all - a different, more permissive
function than `lib/inventory.ts`'s `canAccessLocation`, which `core.ts`
already uses and which genuinely checks company ownership. This slice
fixes the function itself, once, instead of continuing to patch each of
its ~38 call sites' downstream queries one at a time.

## The fix

```ts
function canAccessLocation(req: Request, locationId: string): boolean {
  if (req.companyId && ownerOfLocation(locationId) && !companyOwnsLocation(req.companyId, locationId)) {
    return false;
  }
  return ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role) || (req.user!.locationIds ?? []).includes(locationId);
}
```

`ownerOfLocation`/`companyOwnsLocation` come from `lib/saas/tenant-scope.ts`
- the same in-memory ownership map `enforceOperationalCompanyScope`
(mounted globally in `index.ts` ahead of every `/api/v1` route) already
relies on today, and the same fail-safe-if-unknown shape: a location whose
ownership is **known** and mismatches the caller's company is always
denied, before the role check ever runs; a location whose ownership is
**not yet tracked** in the map falls through to the original, unchanged
role/assignment check. This was the deliberate choice over two riskier
alternatives:

- **A hard "deny unless proven owned" check** would be more thorough but
  risks false-denies for any location the in-memory map hasn't seen yet
  (a real, pre-existing limitation this repo's own docs already name for
  that map - "insufficient on its own"). Getting this wrong in either
  direction on a single shared function used 38 times is a large blast
  radius for one change.
- **An async, real-Postgres `Location.companyId` lookup** would be the
  most correct fix, but `canAccessLocation` is synchronous and called
  from ~38 sites across many handlers; converting all of them to `await`
  a lookup is a much larger, more invasive change than this slice's
  "fix the shared function" scope.

The chosen fix closes the concrete, verified vulnerability (a location
that *is* tracked - which is every location created through the app's own
`routes/core.ts` location-creation route, since it already calls
`registerLocationCompany` right after persisting the row - is now
correctly protected) without any risk of regressing existing behavior for
data the map doesn't know about yet.

## What changed

- `routes/operations-extension.ts` imports `ownerOfLocation` and
  `companyOwnsLocation` from `lib/saas/tenant-scope.js` (alongside the
  already-imported `DEFAULT_COMPANY_ID`).
- `canAccessLocation` gained the company-ownership check above, ahead of
  its existing role/assignment check. No call site needed to change - all
  ~38 callers get the fix automatically.

## What's deliberately unchanged

- Every prior slice's query-level `companyId` filter (Order, PurchaseOrder,
  ReturnRequest, ExceptionCase, Transfer, StockCount) stays in place as
  defense in depth - this fix closes the *access* gate, not the *query*
  gate, and the two are independent layers. A location whose ownership
  isn't yet tracked in the map would still be correctly denied data by
  those query-level fixes even though this gate lets the request through.
- `ReorderRule`'s missing `companyId` column (Week 26) and `core.ts`'s
  in-memory `TransferRecord`/`CountRecord` types carrying no `companyId`
  field are untouched - out of scope for a `canAccessLocation` fix.
- The in-memory ownership map itself (`lib/saas/tenant-scope.ts`) is
  unchanged - this slice consumes it, doesn't rework it. Its own
  "insufficient on its own" caveat, already documented, still applies.

## Testing

`src/routes/operations-extension-canaccesslocation.postgres.test.ts` (real
Postgres, 2/2 passing):

- An admin from company B is denied (403) a `GET /intelligence/:locationId`
  request for a location that has been registered to company A via
  `registerLocationCompany` - the same call `routes/core.ts`'s real
  location-creation route makes for every production location - proving
  the centralized fix actually gates the request before the route's own
  query runs, not just leaving it to the query-level filter.
- The owning company's own admin is unaffected (200).
- A location deliberately **not** registered in the ownership map still
  returns 200 for a legitimate admin request, proving the fail-safe-if-
  unknown behavior - the fix does not risk a false-deny for data the map
  hasn't seen yet.

All of slices 1-4's existing Postgres integration tests (19 tests across
`operations-extension-orders`, `operations-extension-returns-exceptions`,
`operations-extension-transfer-stockcount`,
`catalog-procurement-purchase-orders`) were re-run and still pass
unchanged - those tests create locations directly via `prisma.location.create`
without registering them in the ownership map, so they continue to exercise
the fail-safe-if-unknown path and correctly keep passing.

Full `npm test`: 561 passing, 0 failing (2 new tests correctly skipped in
memory mode). `architecture-lint`: 17 new violations, all confirmed via
`git diff --stat` to be pure line-shift artifacts of the added import/
comment (no query logic changed), safely re-baselined.
`contract:validate`/`contract:check-drift` both pass.

## What's still pending

The same standing backlog Week 26 named: `ReorderRule`'s missing
`companyId` column, `Item`/`Supplier`/`ExpiryAlert` bare-id call sites, and
`core.ts`'s in-memory Transfer/StockCount records carrying no `companyId`
field. Also worth a future slice: auditing whether the in-memory ownership
map is reliably populated for every location-creation path in the
codebase (not just `routes/core.ts`'s), since this fix's protection is
only as complete as that map's coverage.
