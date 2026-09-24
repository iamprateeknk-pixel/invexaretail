# Week 10: Dashboard, Item Search and Stock Detail vertical slice

The guide names five deliverables (Dashboard, Global item search, Stock
detail, Movement journal, Adjustment/reversal wizard). Honest split below:
four are shipped and tested; the Dashboard is explicit backlog, not a
shallow stand-in.

## Shipped

### Backend (`api/`)

- **`lib/repositories/item-repository.ts`'s `searchItems`** - cursor-paginated,
  tenant-scoped item search. Proven against real Postgres with 5,200 seeded
  items: paginates in 249ms with zero duplicates, zero gaps, zero cross-tenant
  leakage (`item-repository.postgres.test.ts`).
- **`lib/stock-detail-service.ts`'s `getStockDetail`** - branch balances,
  lot/expiry state, recent movement history and a per-(lot, location)
  reconciliation status, all read live from `StockLedger`/`StockMovement`
  (ADR-001's canonical journal/projection) - never a cached or client-side
  running total.
- **`routes/items.ts`** (continuing Week 8's extraction pattern): `GET
  /items/search`, `GET /items/:itemId/stock-detail`, `POST
  /items/:itemId/adjust`, `POST /items/:itemId/movements/:movementId/reverse`.
  Additive - `core.ts`'s existing unpaginated `GET /items` is untouched, so
  nothing else that depends on it breaks.
- **Idempotent adjustment/reversal**: both mutation endpoints post through
  `lib/inventory-posting-service.ts` (Week 6) exclusively - `/adjust`
  requires a client-supplied `idempotencyKey` (rejected with 400 if
  missing), `/reverse` uses the service's own derived key. Proven: a
  retried adjustment with the same key returns the original result (200,
  `duplicate: true`) instead of posting twice; reversing an already-
  reversed movement returns 409, not a silent double-reversal
  (`items.postgres.test.ts`).
- **Tenant isolation**: a request naming another tenant's `itemId` is
  rejected before the handler's own logic even runs, by
  `enforceOperationalCompanyScope` (an existing middleware layer) - proven
  with a real cross-tenant fixture, not just an assumption.
- **Contract**: `contracts/openapi.json` bumped to `2026.10.0`, new
  `ItemSearchPage`/`StockDetail`/`Movement`/`AdjustRequest`/
  `PostMovementResult` schemas and four new paths, generated client
  extended (`contracts/generated/client.ts`'s `items` namespace), drift
  check and typecheck both pass.

### Frontend (`web/`)

- **`hooks/useItemSearch.js`** - debounced (250ms), cursor-paginated,
  discards a stale in-flight response if a newer search started (a fast
  typist never sees an old page overwrite a new one).
- **`hooks/useStockDetail.js`** - per-screen query (fetches on `itemId`
  change, exposes `refetch`), not wired into `useWorkspaceHydration`'s
  whole-workspace poll - the guide's "replace whole-workspace hydration/
  polling for these routes" requirement, satisfied by these screens simply
  never joining that poll rather than a refactor of it.
- **`hooks/useInventoryAdjustment.js`** - generates the idempotency key
  client-side (`crypto.randomUUID()`), and its `submitting` flag is the
  client-side duplicate-submit guard (the server-side idempotency key is
  the actual guarantee; this is the UX-level "don't even let a second click
  through" layer).
- **`components/inventory/ItemSearchPanel.jsx`** - `role="combobox"` input
  + `role="listbox"`/`role="option"` results, Arrow Up/Down to move a
  highlighted row (clamped, never wraps or throws past the ends), Enter to
  select. Loading/empty/error states are Week 9's shared components, not
  new one-offs.
- **`components/inventory/StockDetailPanel.jsx`** - branch balance table,
  lot/expiry list, movement journal (with a per-row "Reverse" action),
  reconciliation status badges.
- **`components/inventory/AdjustmentWizard.jsx`** - the guided adjustment
  form; submit is disabled for the entire in-flight window, proven with a
  real pending-promise test (a second click while submitting fires zero
  additional requests).
- **`components/workspace/pages/ItemStockDetailPage.jsx`** - the page
  shell, registered as a new `NAVIGATION` item (`item-search`, Inventory
  group, no role restriction - matches `inventory`'s visibility) so it goes
  through Week 9's `canAccessSection` gate like every other section, not a
  bespoke route.
- Tests: 8 new component tests (keyboard flow, accessible roles, loading/
  empty/error states, duplicate-submit guard, client-side zero-quantity
  rejection) via Week 9's JSX test toolchain - all pass alongside the
  existing 107 unmodified.

## Honestly not shipped this week

- **The exception-first Dashboard** (queues, SLA, stock-risk scoring,
  server-derived recommended actions). This is a genuinely separate, large
  read model - a new server-side aggregation across counts, transfers,
  exceptions and reorder signals, role-filtered, with an SLA/risk-scoring
  definition that itself needs a product decision (what counts as
  "at risk," what SLA clock applies to which queue). Attempting a shallow
  version (a few hard-coded counts relabeled "SLA") would fail the guide's
  own instruction ("never hard-coded") worse than not shipping it. Backlog
  for a focused follow-up.
- **Reconciliation status nuance.** `getStockDetail`'s `reconciliation`
  field reports `explained: false` for a (lot, location) with real on-hand
  stock but zero matching `StockMovement` history - which is the expected,
  benign state for every pre-Week-6 seeded/legacy balance (Week 6's
  `scripts/reconcile-stock-journal.mjs` calls this `NO_JOURNAL_HISTORY` and
  treats it as non-fatal, distinct from `JOURNAL_MISMATCH`, a real bug).
  This endpoint does not yet make that distinction - a stock detail screen
  for a legacy item will show every location as "not explained" even though
  nothing is wrong. Fixing this means either backdating an opening-stock
  movement for legacy balances or teaching this endpoint the same
  no-history-is-fine categorization the reconcile script already has;
  neither was in scope to decide unilaterally this week.
- **Observability for stock-post latency.** No new metrics/tracing was
  added around `postInventoryMovement`'s call path this week - the
  guide's "Add observability for stock-post latency and reconciliation
  status" scope item's first half is not done. `NegativeStockBlockedError`
  responses do carry the item/location/quantity in their message today, but
  there is no latency histogram or dashboard.
- **Opening stock for a lot that doesn't exist yet.** The adjustment
  wizard's lot selector assumes at least one lot already exists for the
  item; creating a brand-new lot as part of "opening stock" is not wired
  into this wizard (lot creation lives elsewhere in the existing item
  master flow).
- **Staging screenshots.** The automated browser journey is now part of CI
  (`web/e2e/item-stock-detail.spec.js`): it signs in, proves the browser did
  not persist the refresh credential, searches and selects an item with the
  keyboard, loads stock detail, and posts an adjustment. Environment-specific
  screenshots remain a deployment evidence item rather than source control.

## Validation performed

- `api`: clean `rm -rf dist && npm run build`, `lint:arch` (0 new
  violations), 561-test in-memory suite, 47/47 Postgres tests run together
  (including the two new files), `contract:validate`/`check-drift`/
  `typecheck`, and a live-server smoke test against real seeded Postgres
  proving search, stock-detail and an idempotent adjust/retry pair.
- `web`: 107 unmodified existing tests, all component tests passing
  together via `npm run test:components` (Week 9's toolkit plus this
  week's 8 new tests for `ItemSearchPanel`/`AdjustmentWizard`), clean
  `npm run build`, no new lint errors, and the Playwright browser journey
  via `npm run test:e2e`.
