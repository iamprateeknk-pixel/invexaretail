# Bare-id call-site migration, slice 7: ExpiryAlert and ReorderRule routes

## Scope

Continues the remediation slices 1-6. This slice: every remaining
`ExpiryAlert` call site in `routes/operations-extension.ts` (already had
a real `companyId` column since Week 22 - only its call sites needed
fixing), and every `ReorderRule` call site in
`routes/catalog-procurement.ts`/`routes/operations-extension.ts`
(`ReorderRule` needed its own migration first - it had no per-company
scoping column at all).

## The ReorderRule migration

`ReorderRule` carried only the constant `tenantId`, no `companyId`.
Unlike `Supplier` (Week 28), it has a real `locationId` relation to
`Location`, which does carry a real `companyId` - so migration
`20261102090000_reorder_rule_company_scope` backfills it the same way
`PurchaseOrder`/`Order`/`Transfer`/`StockCount`/`ExpiryAlert` were: join
through the rule's own `Location`.

## The real vulnerabilities, not just a lint nag

- **`PUT /reorder-rules/:itemId`** had **no location-ownership check of
  any kind** - only `requireAdmin`. Worse than a read leak: any admin of
  any company could set the reorder min/target quantities for *any*
  location and item, including another company's, a genuine cross-tenant
  write. Fixed with an explicit `Location` ownership check before the
  upsert, the same pattern used for `GET /purchase-orders/plan` (Week 26)
  and `PUT /suppliers/:id` (Week 28).
- **`GET /reorder-rules`**, the reorder-rule query inside `GET
  /items/:itemId/forecast`, and the reorder-rule query inside `GET
  /intelligence/:locationId` all had no `companyId` filter - the last of
  these is the exact gap Week 26's own writeup named and left open
  ("`ReorderRule` visibility in `GET /intelligence/:locationId` is still
  not company-scoped"). All three still sit behind role/location checks
  that admins bypass (the same permissive shape documented since Week 23),
  so without a `companyId` filter an admin of a different company could
  see another company's reorder rules and their resulting recommendations.
- **`PATCH /expiry-alerts/:id/status`** and **`POST
  /expiry-alerts/:id/write-off`** each looked their `ExpiryAlert` up by
  bare id with no `companyId` filter, relying only on `canAccessLocation`
  for protection - which, since Week 27's centralized fix, only denies a
  *known* cross-company location, not an unregistered one. Both now filter
  directly by `companyId` as well, independent of that fallback.

## What changed

- Migration `20261102090000_reorder_rule_company_scope`: adds
  `ReorderRule.companyId`, backfilled from `Location.companyId` via the
  rule's own `locationId`.
- `catalog-procurement.ts`: `GET /reorder-rules` and the two
  `reorderRule.findMany` calls in `GET /purchase-orders/plan` gained a
  `companyId` filter (the `plan` route's rule query was already sitting
  behind a location-ownership check from Week 26, so this is defense in
  depth, not a new gap). `PUT /reorder-rules/:itemId` gained an explicit
  `Location` ownership check (404 on a foreign location) and now stamps
  `companyId` on create.
- `operations-extension.ts`: the reorder-rule queries in `GET
  /items/:itemId/forecast` and `GET /intelligence/:locationId` gained a
  `companyId` filter. `PATCH /expiry-alerts/:id/status`'s
  `expiryAlert.findUnique` changed to `findFirst` with `companyId`. `POST
  /expiry-alerts/:id/write-off`'s `tx.expiryAlert.findUnique` (inside its
  transaction) changed the same way.

## What's deliberately unchanged

- `lib/item-master-service.ts`'s `deleteItemPermanently`'s
  `reorderRule.deleteMany({ where: { itemId } })`/`expiryAlert.deleteMany`
  calls are safe by construction: `itemId` comes from `requireItem(ctx,
  itemId)`, already tenant-verified via the scoped item repository before
  this cascade delete runs.
- `syncExpiryAlerts()` (the dead-code write path named in Week 22, still
  never called from anywhere in `src/`) already sets `companyId` correctly
  from `StockLedger.companyId` - untouched, no change needed.
- `GET /expiry-alerts` and `GET /expiry-board` compute synthetic,
  in-memory alert projections straight from `StockLedger` filtered by a
  `canAccessLocation`-checked `locationId` - they never query the
  `ExpiryAlert` table at all, so they're out of scope for this slice.

## Testing

Updated one existing test and added two new real-Postgres HTTP test
files, reusing the established `withServer`/`makeFixture` harness:

- `src/routes/operations-extension-transfer-stockcount.postgres.test.ts`
  (Week 26): its `GET /intelligence/:locationId` test previously asserted
  the *pre-fix* behavior (a cross-tenant admin could still see the reorder
  rule, just with degraded confidence) - updated to assert the rule itself
  is now invisible to a cross-tenant admin (`crossRec` is `undefined`),
  since that was an explicitly named, now-closed gap.
- `src/routes/catalog-procurement-reorder-rules.postgres.test.ts` (3/3
  passing): `GET /reorder-rules` returns an empty list (not another
  company's data, not an error) for a location it doesn't own; `PUT
  /reorder-rules/:itemId` 404s on a cross-tenant `locationId` and confirms
  no row was created, while the owning company's own write still succeeds
  and is stamped with its real `companyId`; `GET /purchase-orders/plan`
  still 404s on a cross-tenant `locationId` (Week 26 regression check).
- `src/routes/operations-extension-expiry-alerts.postgres.test.ts` (2/2
  passing): `PATCH /expiry-alerts/:id/status` and `POST
  /expiry-alerts/:id/write-off` both 404 on a cross-tenant alert id and
  confirm the alert's status is genuinely unchanged, while the owning
  company's own status change still succeeds.

All prior slices' Postgres integration tests (35 tests total across nine
files) were re-run together and pass. Full `npm test`: 561 passing, 0
failing (5 new tests correctly skipped in memory mode).
`architecture-lint`: 6 new violations, all confirmed via `git diff --stat`
to be pure line-shift artifacts of the additive schema/route changes,
safely re-baselined. `contract:validate`/`contract:check-drift` both
pass. `lib/schema-version.postgres.test.ts` re-run against the newly
migrated database and still green.

## What's still pending

`core.ts`'s in-memory `TransferRecord`/`CountRecord` types still carry no
`companyId` field, relying entirely on the in-memory ownership map rather
than a real column (Week 27's standing follow-up). Auditing whether that
map is reliably populated for every location-creation path in the
codebase remains a worthwhile follow-up too. With `ExpiryAlert` and
`ReorderRule` done, every model named across this remediation's seven
slices now has its route-level bare-id call sites fixed; any further
slice would be net-new scope (e.g. `core.ts`'s in-memory records, or
widening past the `unscoped-tenant-query` rule's current
`TENANT_SCOPED_MODELS` list toward the full `OPERATIONAL_TENANT_TABLES`).
