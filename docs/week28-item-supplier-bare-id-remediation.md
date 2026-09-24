# Bare-id call-site migration, slice 6: Item and Supplier routes

## Scope

Continues the remediation slices 1-5. This slice: every remaining
route-level `Item` bare-id call site in `routes/operations-extension.ts`
and `routes/catalog-procurement.ts`, and every `Supplier` call site in
`routes/catalog-procurement.ts` - the latter requiring a real schema
migration first, since `Supplier` had no per-company scoping column of
any kind before this slice (only the constant `tenantId`).

Two directly-adjacent findings turned up while doing this and are fixed
in the same slice rather than left dangling: `SavedView`'s item-listing
route (`GET /saved-views/:id/items`) had a completely unfiltered
`prisma.item.findMany()` behind its own bare-id `SavedView` lookup, and
`POST /connectors/:id/ingest` had the same bare-id gap on both
`MarketplaceConnector` and the SKU-to-`Item` lookup inside it.

## The Supplier migration

`Supplier` had no `companyId` at all - the same complete gap `ExceptionCase`
had before Week 12. Unlike `PurchaseOrder`/`Order`/`Transfer`/`StockCount`/
`ExpiryAlert`, a `Supplier` has no `Location` (or any other single-owner
relation) to backfill from - and, because this very gap let a purchase
order reference a supplier from any company, a supplier can legitimately
already have purchase orders from more than one company today. There is
no honest single "true owner" to compute from existing data, so migration
`20261030090000_supplier_company_scope` backfills every existing row to
the same `'default-company'` constant this migration series already uses
whenever no better source exists (`ExceptionCase`, Week 12) - a documented
approximation, not a claim that every pre-existing supplier really belongs
to that company.

## The real vulnerabilities, not just a lint nag

- **`GET /suppliers`** took `_req` (an unused parameter - the same tell as
  Week 24's `GET /purchase-orders`) and returned **every company's
  suppliers** to any authenticated user, with no filter of any kind.
- **`POST /suppliers`** never set a `companyId` on creation - before the
  migration this couldn't even be scoped; after it, every new supplier
  would have silently landed under the schema default rather than the
  creating company.
- **`PUT /suppliers/:id`** and **`GET /suppliers/:id/score`** each looked
  a supplier up by bare id with no company check, then updated it or
  computed its purchase-order-backed reliability score - an admin of one
  company could edit or read the score of another company's supplier
  given or guessing its id.
- **`POST /purchase-orders`** (create) looked up its `supplierId` and its
  line items' `itemId`s with no company check at all, and - worse - never
  even verified every requested `itemId` actually resolved to a real,
  matched item; only items that *did* resolve were checked for `ACTIVE`
  status. A cross-tenant (or simply nonexistent) item id would silently
  end up as a real line on the created purchase order. `GET
  /purchase-orders/plan` and `POST /purchase-orders/plan/draft` had the
  same unscoped supplier lookups.
- **`POST /items/:itemId/prices`** looked its item up by bare id with no
  company check before creating a price record against it.
- **`GET /saved-views/:id/items`**: the `SavedView` lookup itself had no
  company check, and the item list behind it - `prisma.item.findMany({
  include: { tags: true } })` - had **no filter of any kind**, returning
  every company's entire item catalog through any saved view, including
  one belonging to a different company. Also fixed in passing:
  `GET /saved-views`'s `isShared` branch had no company filter either (a
  shared saved view was visible company-wide, not company-scoped), and
  `DELETE /saved-views/:id` had the same bare-id gap as the others.
- **`POST /connectors/:id/ingest`**: `MarketplaceConnector` (whose
  `tenantId` field is actually used as the real company identifier here,
  set from `req.user!.companyId` at creation) was looked up with no
  company filter in *either* its in-memory or its Postgres path - the
  in-memory `findConnector()` result was tried first via `??`, so even
  fixing only the Postgres branch would have left the memory-mode path
  wide open. Each SKU-to-`Item` lookup inside the ingest loop was
  similarly unscoped, letting a marketplace order silently create an
  order line against another company's item.

## What changed

- Migration `20261030090000_supplier_company_scope`: adds `Supplier.companyId`.
- `catalog-procurement.ts`: `GET /suppliers` (`_req`→`req` + `companyId`
  filter), `POST /suppliers` (sets `companyId` on create), `PUT
  /suppliers/:id` and `GET /suppliers/:id/score` (`findUnique`→`findFirst`
  with `companyId`), `GET /purchase-orders/plan`'s and `POST
  /purchase-orders/plan/draft`'s supplier lookups (same fix). `POST
  /purchase-orders`'s item lookup gained a `companyId` filter *and* an
  explicit check that every requested `itemId` was actually found,
  rejecting the request otherwise (closing the "unresolved item silently
  becomes a real order line" gap, not just the tenant-scope one). `POST
  /items/:itemId/prices`'s item lookup, `GET /saved-views`'s `isShared`
  scope, `DELETE /saved-views/:id`, and `GET /saved-views/:id/items` (both
  its `SavedView` lookup and the item list behind it) all gained the same
  `companyId` filter/scoping.
- `operations-extension.ts`: `GET /items/:itemId/forecast`'s and `POST
  /qc-inspections`'s item-name/category lookups, and `POST
  /items/:itemId/serials`'s item lookup, converted to `findFirst` with
  `companyId`. `POST /connectors/:id/ingest`: the in-memory
  `findConnector()` result is now checked against the caller's
  `companyId` (via its `tenantId` field) before use, and the Postgres
  fallback query gained the same filter; the per-line SKU-to-`Item`
  lookup gained a `companyId` filter too.

## What's deliberately unchanged

- `catalog-procurement.ts`'s `item.findMany` at what is now line 324 (used
  during PO receiving to look up lot/expiry rules for a PO's own lines) is
  safe by construction: its `itemIds` come from `order.lines`, and `order`
  was already resolved through the `companyId`-scoped `findFirst` a few
  lines above.
- `operations-extension.ts`'s `returnQcContext()` bulk `item.findMany`
  (used for QC-required checks during return receiving) is likewise safe
  by construction: its `itemIds` come from an already tenant-verified
  `returnRequest`'s own lines.

## Testing

Two new real-Postgres HTTP test files, reusing the established `withServer`/
`makeFixture` harness pattern:

- `src/routes/catalog-procurement-item-supplier.postgres.test.ts` (7/7
  passing): `GET /suppliers` company-scoped listing; a newly created
  supplier stamped with the real companyId; `PUT /suppliers/:id` and `GET
  /suppliers/:id/score` 404 on a cross-tenant id; `POST /purchase-orders`
  rejects both a cross-tenant supplier (404) and a cross-tenant item (400,
  the new explicit not-found check) while the owning company's own
  supplier/item still works; `POST /items/:itemId/prices` 404s on a
  cross-tenant item; `GET /saved-views/:id/items` 404s on a cross-tenant
  saved view and never includes another company's items in its result.
- `src/routes/operations-extension-connectors.postgres.test.ts` (2/2
  passing): `POST /connectors/:id/ingest` 404s on a cross-tenant connector
  id, and a SKU resolving to another company's item is rejected as
  "Unknown SKU" rather than silently used.

Full `npm test`: 561 passing, 0 failing (9 new tests correctly skipped in
memory mode - `Supplier.companyId` is a real Postgres column).
`architecture-lint`: 14 new violations, all confirmed via `git diff
--stat` to be pure line-shift artifacts of the additive schema/route
changes (no logic removed), safely re-baselined.
`contract:validate`/`contract:check-drift` both pass.
`lib/schema-version.postgres.test.ts` re-run against the newly migrated
database and still green (proves the migration script itself never
mutates schema on a later run).

## What's still pending

`ExpiryAlert`/`ReorderRule` bare-id call sites, `core.ts`'s in-memory
Transfer/StockCount records carrying no `companyId`, and auditing the
in-memory location-ownership map's coverage (Week 27's standing follow-up)
remain outstanding.
