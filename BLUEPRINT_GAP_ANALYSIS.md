# Invexa Retail — Blueprint Gap Analysis

Reviewed against: `Invexa Retail Fresh Competitor Re-Audit & Category-Leading Implementation Blueprint —
Developer Edition V3` (16 September 2026).

This replaces the previous gap-analysis note, which was written against the older v1.0 blueprint and had
drifted out of date. Per the blueprint's own developer-handoff rule ("after each phase, update this document
from actual main code"), this file must be rewritten again after every phase closes — it is a living document,
not a one-time report.

## 1. P0 — repo stabilization (CLOSED)

The blueprint's P0 required landing four open items safely before any new feature work:

| Item | Outcome |
| --- | --- |
| PR #122 (SaaS closeout: local Stripe, Drift NativeDatabase, operational `tenantId`) | Merged to `main`. |
| PR #119 (blueprint P2–P11: mobile role home, generic offline queue, scan enforcement, `BinStock`, split fulfilment, connectors, QC, intelligence) | Content merged directly to `main` (two commits — see PR #119 for the conflict-resolution notes); PR closed. |
| PR #118 (OTP sign-in, web + Flutter) | Rebased onto current `main`, two conflicts resolved (`.cursor/environment.json`, `LoginCard.jsx` — kept both this branch's OTP tabs and main's "Open Platform Control Plane" button), merged; PR closed. |
| PR #78 (old Hostinger entry-point fix) | Superseded — current `main`'s `api/app.js` + root `app.js` shim + CI boot smoke are already more robust than this PR proposed. Verified locally (`node app.js` → `/health` and `/ready` both 200) and closed without merging. |

**Flutter analyzer**: `flutter analyze` was failing on `main` after the P2–P11 merge — `DriftStore` (PR #122)
didn't implement the `LocalStore.loadQueuedActions`/`saveQueuedActions` methods the P2–P11 merge added to the
interface. Fixed by adding a `queued_actions` table to `NativeDatabase` and wiring `DriftStore`. Also fixed two
`invalid_use_of_protected_member` warnings (`ScanScreen` calling `SessionController.notifyListeners()` directly
from outside the class) by adding a `setNotice()` method mirroring the existing `setError()`.

**Exit condition status**: one clean `main`; API tests green (296/296); web tests/build green (63/63,
`vite build` clean); admin-panel Cloudflare Control Plane smoke green (5/5); Hostinger `/health` + `/ready`
verified locally. No open implementation PRs remain (`gh pr list --state open` → empty). Flutter
analyze/test/APK CI status should be re-checked once the fix above lands (this session has no local Flutter
SDK to run it directly — verified via GitHub Actions logs and static/brace-balance review instead).

## 2. What is already strategically strong (confirmed against blueprint §2)

| Strength | Where |
| --- | --- |
| Immutable stock truth | `StockLedger`/`StockMovement` — idempotent (`dedupeKey`), no direct quantity overwrite. |
| Transfer + count controls | Blind counts, `CountAssignment`, approvals, evidence rules (`lib/evidence-rules.ts`), exceptions (`lib/exceptions.ts`), quarantine/damaged states, pick waves. |
| SaaS Control Plane | Company lock, plans/entitlements (`lib/saas.ts`), tenant suspension, kill switches, usage metering, API keys, webhooks, local + real Stripe billing. |
| Runtime configuration | **Correction from the previous pass of this doc**: the Studio backend is far more built than it first looked. `ConfigurationVersion` (`api/src/lib/saas/control-plane.ts`) already carries `page` (columns/actions/tabs/widgets), `fields`, `workflows` (trigger→condition→action graph + `simulateWorkflow`), `rules`, `reports`, `automations` and `mobilePolicies`, with a real draft → preview(role/device) → publish → rollback → diff/audit pipeline (`studioRouter` in `routes/control-plane.ts`). What was actually missing was (a) a generic rule *evaluator* — `evaluateRule` only recognized two hardcoded rule keys, so a rule created via the API could never fire — fixed this pass; and (b) Studio UI for anything past stock columns. See §4a. |
| India retail fit | Sales/purchase imports, branch operations, Amazon/Flipkart/website order ingestion (`lib/connectors.ts`). |

## 3. Fresh gap matrix — current `main` vs blueprint §4

| Capability | Status on `main` | Note |
| --- | --- | --- |
| Offline/mobile simplicity | PARTIAL | Generic `QueuedAction` retry queue now exists (P2–P11 merge) alongside company-scoped queued counts; role-specific mobile home exists (`role_home.dart`, pick/putaway/receive/scan screens). Conflict-resolution contract now exists: `classifySyncFailure()` (`services/sync_resolution.dart`) turns a failed sync into retry (offline/401, auto-retried) vs conflict (409) vs rejected (any other 4xx/5xx) - the latter two stop auto-retrying, get a `status` on the queued item, and surface a Conflict/Rejected badge + Retry/Discard actions on the dashboard instead of retrying forever silently. Still open: this classifies by HTTP status only - no endpoint yet returns a version/field-level diff to show the user *what* conflicted. `screens/count_screen.dart`'s item picker previously fell back to the whole catalog for any ad-hoc-capable role even when that user had real assignments (the assignment was silently overridden) - fixed so an active assignment always wins, for every role. "Scan" across the mobile app was a bare text field with no actual camera - `widgets/barcode_scan_sheet.dart` now wraps `mobile_scanner` for a real full-screen camera scan (torch, camera flip, manual-entry fallback on camera error), wired into item selection and scan-to-increment quantity entry in the count screen, and bin scanning in the guided pick walk. The item dropdown on that same screen (and a native dropdown generally, once a catalog has more than a handful of SKUs) had no way to type to filter - `widgets/item_search_field.dart` replaces it with a tap-to-open full-screen search (name/code). Stock screen previously listed one row per item+lot with no aggregate view; it now groups by item (lot count, total on-hand/book qty), adds a search box, and tapping an item opens a bottom sheet with the per-lot breakdown. None of this mobile work could be run through `flutter pub get`/`analyze` in the session that wrote it (no Flutter SDK in that environment) - unverified until a real Flutter build runs against it. |
| Item photos / visual inventory | PARTIAL | Multi-image upload + primary thumbnail per item now exists (`lib/item-photos.ts`, `ItemPhotoGallery.jsx`). No compression, no lot/serial-level evidence photos, no thumbnails surfaced in scan/search yet. |
| Folders/tags/views | PARTIAL, close to done | `Tag`/`ItemTag` exist. `SavedView` + `lib/saved-view-filter.ts` now add saved smart folders: a stored filter (category/subcategory/tags/search) re-run live against the catalog rather than a static snapshot. `GET/POST/DELETE /saved-views`, `GET /saved-views/:id/items`. Web UI now exists (`SmartFoldersCard.jsx` on the Catalog page - create/list/preview/delete). No mobile UI yet. |
| Check-in/out custody | **DONE** | Was already built (`AssetsPage.jsx`, `assetCheckouts` Prisma model) — this doc's earlier "MISSING" was wrong, found on re-audit. Assign/due-date/condition/return existed; only the overdue→alert link was missing, added this pass. |
| Serial tracking | PARTIAL | `SerialNumber`/`SerialMovement` models + `lib/serial-tracking.ts` state machine (register/list/lookup/move routes in `operations-extension.ts`), with a recall-trace builder. Web UI now exists (`ItemSerialPanel.jsx` — register/list/trace/move, opened from Item Details). No mobile UI yet, and the GS1 parser's extracted `serial` field is surfaced in the scan status message but not yet auto-wired to register/look up a `SerialNumber` on scan. |
| GS1 / embedded barcodes | **DONE (parsing)** | `lib/gs1.js` parses AIs (GTIN, batch/lot, expiry, weight, serial) and is wired into the scan-to-count flow (`useWorkspaceStock.js`). Not yet linked to serial-tracking records. |
| True bin stock | **DONE** | `BinStock` model + `lib/bin-stock.ts`, reconciled to location ledger (landed via the P2–P11 merge). Explicit bin-to-bin transfer ledger now also exists (`BinMovement` model, `lib/bin-move.ts` scan validation, `moveBinStockPersisted()`, `POST /locations/:locationId/bin-transfers`). Internal replenishment now also exists: `Bin.isPickFace`/`pickFaceMin`/`pickFaceMax` + `lib/pick-face-replenishment.ts` suggests reserve→pick-face moves below min, surfaced via `GET /locations/:locationId/pick-face-replenishment`; execution reuses the same scanned bin-transfer route. |
| Pack & ship station | PARTIAL | Pack verification now exists: `PackSession`/`PackedLine` + `lib/pack-verification.ts` (`verifyPackScan` - MATCHED/SHORT/OVER/UNEXPECTED per line, seal blocked until every line matches exactly), `POST /orders/:id/pack/{start,scan,seal}` + `GET /orders/:id/pack`. Additive on top of Order/OrderLine - never changes `Order.status`. Now wired to real AWB booking via the carrier adapter (see below). No web/mobile pack-station UI yet, no pack-slip/label PDF printing (label URL field exists on `Shipment` but the local adapter returns none). |
| Carrier integrations | PARTIAL | `CarrierAdapter` interface + `Shipment` model now exist (`lib/carrier-adapter.ts`): rates, serviceability, createShipment/AWB, tracking, cancel, behind `POST /orders/:id/ship`, `GET /orders/:id/shipment`, `POST /shipments/:awb/cancel`. Only a `LocalCarrierAdapter` is wired in (deterministic, no external API) — real Delhivery/Shiprocket/Blue Dart adapters plug into the same interface but aren't built (need commercial API access). |
| Split fulfilment | **DONE** | `OrderLine.fulfillmentLocationId` + `lib/order-routing.ts` (distance/SLA/cost/workload routing). |
| Promise engine | **DONE** | ATP/reservation + expiry already existed (`Order.reservedAt`/`reservationExpiresAt`). `lib/promise-engine.ts`'s `estimateDispatchAndDelivery()` now adds a deterministic (no ML) estimated dispatch/delivery date per order, with a larger safety buffer for marketplace channels than the website, using each location's existing `deliverySlaHours`. |
| Marketplace connectors | **DONE (Amazon/Flipkart/website)** | `lib/connectors.ts` + signed webhook ingestion into `createOrderWithReservation`. Shopify/WooCommerce/quick-commerce not started. |
| Connector sync journal / dead-letter queue | **DONE** | `WebhookDeliveryLog` already tracked request id/retry count/response/error; now also records `payloadHash` + `nextRetryAt` + the request `body` itself. `lib/webhook-retry.ts` (deterministic 1min→12hr backoff, dead-lettered after 5 attempts) + `lib/webhook-dispatcher.ts`'s `replayDelivery()`/`retryDueDeliveries()` let a failed delivery be safely replayed byte-identical instead of retried forever or silently dropped. `POST /webhook-deliveries/:id/replay`, `POST /webhook-deliveries/retry-due`. |
| Forecasting | PARTIAL, close to done | `lib/demand-forecast.ts`: deterministic demand stats (mean/stddev of daily sales), King's-formula safety stock, days cover, projected stockout date, and `suggestReplenishment()` (reorder point + suggested qty net of on-order). `GET /items/:itemId/forecast?locationId=` now also returns `expiryActions` and `overstock` for the item at that location (same `buildExpiryActionRecommendations`/`buildOverstockRecommendations` used by `/intelligence/:locationId`, scoped to one item), so a single call shows replenishment, expiry risk and network-transfer opportunity together. Web UI now exists (`ItemForecastPanel.jsx`, opened from Item Details). No mobile UI yet. |
| Landed cost / COGS | PARTIAL | `lib/landed-cost.ts`'s `allocateLandedCost()` splits a PO's freight/customs/insurance/handling charges across its lines by value, weight or quantity; wired into `POST /purchase-orders/:id/receive` so each received lot's attributes carry `landedUnitCost`. No weighted-average/FIFO valuation policy or margin-truth report yet — this is cost capture at receipt, not a running valuation engine. |
| Vendor score | **DONE** | `lib/vendor-score.ts`'s `computeVendorScore()` (fill rate, on-time delivery %, average lead time, short/excess receipt counts, quality reject rate from `QcInspection`) + `computePriceVariance()` (earliest vs latest unit cost per item). `GET /suppliers/:id/score`. |
| 3-way match | **DONE** | `SupplierInvoice`/`SupplierInvoiceLine` + `lib/three-way-match.ts`'s `matchThreeWay()` (PO vs already-tracked `receivedQty` vs submitted invoice, tolerance-based `PRICE_VARIANCE` + `OVER_INVOICED_QTY` + `UNKNOWN_ITEM` exceptions). `POST/GET /purchase-orders/:id/invoices`. |
| Retail pricing | PARTIAL | `PriceList` model (MRP/retail/wholesale/institutional/web/marketplace/branch/customer-group/promotional price types, branch- and customer-group-scoped, effective date range). `lib/price-guardrails.ts`'s `validatePrice()` blocks a price above MRP, below landed cost, or with an invalid effective date range, and warns (without blocking) when it clears cost but misses the minimum margin. `GET/POST /items/:itemId/prices`. Web UI now exists (`ItemPricingPanel.jsx`, opened from Item Details - list prices, add a price with guardrail feedback). No price-resolution endpoint yet (most-specific-wins lookup across branch/customer-group/effective-date for a given item+context), no promotion/campaign scheduling UI, no mobile UI. |
| Returns/RMA | PARTIAL, close to done | `ExceptionCase` still covers damage/shortage/missing-stock as owned cases. Now also `ReturnRequest`/`ReturnLine` + `lib/returns-rma.ts`: a formal customer-return flow (REQUESTED → APPROVED/REJECTED → RECEIVED → CLOSED state machine, quantity validated against remaining eligible fulfilled qty) with per-line inspection disposition (RESTOCK/SCRAP/RETURN_TO_VENDOR) at receive time - only RESTOCK posts stock back onto the ledger. `POST/GET /orders/:id/returns`, `PATCH /returns/:id/status`. Web UI now exists (`OrderReturnsPanel.jsx`, opened from a fulfilled channel order - request a return, then Approve/Reject, Receive with per-line disposition, Close). No mobile RMA UI yet. |
| Kits/assemblies/repack | MISSING | No bundle/BOM/assembly model. |
| Self-service BI | PARTIAL | `enterprise-analytics.ts` + dashboards exist; no pivot/report builder or scheduled reports. |
| Universal no-code Studio | PARTIAL, backend ahead of UI — see §4a | Draft/publish/rollback pipeline and column/rule/report/automation/mobile-policy data model + upserts all exist; Studio UI now covers columns, rules, reports, automations and mobile policy (this pass). Page/field builders for arbitrary entities (not just stock), navigation builder, and the plan→company→branch→role→user inheritance/effective-config inspector from blueprint §16 are still not built. |

## 4. Recommended next phase (per blueprint §21)

P0 is closed. Per the blueprint's own sequencing, **P1 (Control Plane + Studio consolidation)** is next and
marked CRITICAL. `control.invexaretail.com` now receives a locked-company session handoff from the Cloudflare
admin-panel worker. Platform Studio 2.0 work is in progress — see §4a for what shipped and what's still open.
After P1, P2 (Sortly+ UX: item photos, smart folders, check-in/out) and P3 (serial/GS1 traceability) are the
next HIGH-priority phases before P4 (WMS 3.0 + Mobile 3.0 execution).

### 4a. P1 Studio progress (this pass)

- **Generic rule engine.** `evaluateRule()` special-cased two rule keys with bespoke logic; a rule created
  through the API/UI could never fire. Replaced with a real condition/outcome evaluator: condition keys ending
  `Gt`/`Gte`/`Lt`/`Lte` compare a context field numerically, everything else is equality, all conditions on a
  rule AND together, outcome resolves via an `action` key. Deterministic — no ML — per blueprint §13's "do not
  hide behind AI" rule.
- **Rule Builder UI** (Studio → Rules): single-condition rule creation, draft list, test-evaluate against a
  JSON context before publish.
- **Report Builder UI** (Studio → Reports): dataset entity + columns, draft list. Filters/pivot/scheduling
  (blueprint §17/P12) not built yet.
- **Automations Builder UI** (Studio → Automations): trigger type + expression + action key, draft list.
  Records intent only — there is still no job runner that actually executes an automation's `actionKey`.
- **Mobile Policy Builder**, backend + UI: `upsertMobilePolicy()` and `POST /studio/v1/mobile-policy` didn't
  exist before this pass (only a GET). Added both, plus a Studio tab (role, offline max hours, sync scope,
  navigation).

- **Generic Field Builder** (Studio → Fields): `addField()` + `POST /studio/v1/fields` work across any
  `entityType`, not just the stock page (`addStockColumn` is unchanged, kept for its `page.columns` mirroring).
- **Workflow Builder UI** (Workflows section): create-workflow form (key/name/approval threshold) building the
  same trigger→condition→action→approval graph shape `simulateWorkflow` already read generically; simulate
  form now takes any workflow key instead of only `transfer.approval`.

**Still open for P1**: a Page/Navigation builder, the plan→company→branch→role→user inheritance chain with an
effective-config inspector, and an automation execution runner (Automations Builder records intent; nothing
executes an automation's `actionKey` yet). Deferred in favor of starting P2 — these are architecturally
significant and better scoped against a concrete P2+ feature that actually needs them, per the blueprint's own
"complete one vertical before adding another half-integrated module" rule.

## 4b. P2 (Sortly+ frontline experience) — started

- **Item photos** (blueprint P1 "Item media"). `api/src/lib/item-photos.ts`: multi-image upload per item with a
  primary thumbnail, following the existing `TransferEvidence` FK-free LONGBLOB pattern (no R2/S3 dependency
  this repo doesn't otherwise have) — `POST/GET /items/:itemId/photos`, `GET/DELETE .../photos/:photoId`. Web:
  `ItemPhotoGallery.jsx` (adapted from `TransferEvidenceGallery.jsx`), opened via a "Photos" button in
  `ItemDetailsDialog`.

- **Overdue asset alert**. Re-audit found check-in/out custody (`AssetsPage.jsx`) already fully built — this
  doc previously and wrongly marked it MISSING. The one real gap was that overdue checkouts never fed the
  Alerts inbox the way low-stock/expiry/count-work already do. Added `overdueAssetCheckouts` in
  `useWorkspaceDerived` and wired it into `AlertsPage`.
- **Universal quick add**. There was no item-creation UI anywhere (only bulk import or direct API), and
  scanning an unrecognized barcode was a dead end ("Admin can add it through the inventory import"). Added
  `QuickAddDialog.jsx`: code+name required, category/subcategory/company/unit behind progressive disclosure.
  Reachable from the command palette (manual) and from the scanner when a scan has no match (prefills the
  scanned code) — the camera/scan/manual modes blueprint §6 calls for.

**Re-audit note**: before building each item this pass, re-checked whether it already existed — the previous
pass's gap matrix had two wrong MISSING calls (check-in/out custody, team comments/@mentions — the latter
already existed as `itemComments`/`postItemComment`). Grep the actual code before trusting this table's own
prior claims.

- **Pinned shortcuts for the blueprint's named examples**. Low Stock and Expiring already had dashboard KPI
  tiles (`low_stock`/`expiry_risk` in `DASHBOARD_KPI_CATALOG`); Pending Putaway and My Tasks did not. Checked
  first whether `SavedView`/`saved-view-filter.ts` (the smart-folders engine) could express them instead - it
  can't: that engine filters catalog items by category/subcategory/tags/search, and these four are computed
  operational states (stock level, lot expiry, open tasks), not item attributes, so slotting them into
  smart folders would mean bolting unrelated filter dimensions onto a mechanism that already does one thing
  well. The dashboard KPI tiles are the actual existing "pinned shortcut" surface for this kind of thing (a
  labeled, badge-counted, one-click card that navigates to the relevant section) - Low Stock/Expiring already
  prove the pattern, so this pass added the other two the same way instead of inventing a second mechanism.
  New `pending_putaway` tile (open `PutawayTask` count at the current location, from `useWorkspacePutaway`'s
  existing task list, now also loaded on the dashboard - not just the Putaway page itself - since the tile
  needs a live count wherever it's shown) and `my_tasks` tile (count assignments still `ASSIGNED` to the
  signed-in user - `/count-assignments/mine` is already scoped server-side to "mine", so no new query or
  client-side user filtering was needed). Both added to the default KPI set. Zero backend changes - this
  closes entirely by wiring together data the API already exposed.

**Still open for P2**: barcode/QR label studio (label printing exists per-item/lot already via
`printItemLabel`; no batch/template studio), alerts channel/team preferences, and the offline
conflict-resolution UX noted in §3.

## 5. Non-negotiable invariants (blueprint §20) — spot-checked, not violated

No direct-editable stock quantity, location balance derived from movements, reservation capped by
availability, offline clients submit commands not overwrites, external orders carry idempotency keys
(`dedupeKey` on `InventoryMovement`, marketplace webhook signing) — all still hold on current `main`. Not
independently re-audited line-by-line in this pass; flag any violation found in later phases here.
