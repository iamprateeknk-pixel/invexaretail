# Phase 3: virtual bundles / kits

## What was checked first

Phase 3 was planned as "reorder points, auto-PO, serial/batch, bundles, price
lists". Reading the code showed most of that already exists:

- Reorder rules (min/target/order multiple), `GET /purchase-orders/plan`
  (demand window, open POs, in-transit, supplier lead-time stats, MOQ, price
  breaks, optional EOQ) and `POST /purchase-orders/plan/draft`, with a web UI in
  `PurchaseOrdersPage.jsx`.
- `SerialNumber`/`SerialMovement` models and `ItemSerialPanel`.
- `PriceList` model and `ItemPricingPanel`.

The one real gap was bundles/kits, so that is what Phase 3 ships.

## Bundles

A bundle is an `Item` with rows in `ItemBundleComponent`. It owns no stock;
`lib/bundle-availability.ts` derives "how many can be sold" from the scarcest
component (on hand minus reserved).

- `GET /api/v1/items/:itemId/bundle[?locationId=]` - components + `buildable` +
  `limitingItemId`. Any authenticated role.
- `PUT /api/v1/items/:itemId/bundle` - replace the component list. Admin only.
- `DELETE /api/v1/items/:itemId/bundle` - remove the definition. Admin only.
- Rules: no empty bundle, no self-reference, no duplicate component, positive
  quantity, no nesting (a component cannot be a bundle, and a component cannot
  become one). Quantity is `Decimal(12,3)`.
- Cross-tenant ids resolve to 404 (never 403), same as the other scoped routes.
- Migration `20261109090000_item_bundle_components` is additive (one new table).

## Not done (honest gaps)

- Selling a bundle does not yet expand into component stock movements; this is
  availability and definition only. Order ingest would need to expand lines
  through `lib/inventory-posting-service.ts`.
- DB-only (no in-memory mirror), like branches.
- Not in the OpenAPI contract yet (only extracted routes are).
- `routes/bundles.postgres.test.ts` could not be run in the authoring sandbox
  (no Postgres, Docker daemon off); it relies on CI's Postgres service.
- Web: `BundlePanel` on the Item stock detail page; the dashboard "Low stock"
  attention card now opens the purchase plan for admins.
