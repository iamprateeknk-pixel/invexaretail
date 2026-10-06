# Route ownership matrix (Week 8)

Week 8's required delivery package asks for "the route ownership matrix and
any remaining god-router extraction backlog." This is that matrix - the
full inventory of every route on `core.ts`, `operations-extension.ts`, and
the now-retired `foundation.ts`, honestly split into "extracted this week,"
"owned by an existing dedicated router," and "backlog."

## Starting scale

| File | Lines | Routes | Status before Week 8 |
|---|---|---|---|
| `routes/core.ts` | 3,885 | 93 | God router - Inventory, Transfers, Stock Counts, Adjustments, Pickers, Imports, admin, all mixed together |
| `routes/operations-extension.ts` | 2,498 | 88 | God router - Warehouse (bins/putaway/serials), Orders, Returns, QC, Exceptions, SaaS admin, webhooks, all mixed together |
| `routes/foundation.ts` | 673 | 24 | Unmounted dead code (confirmed Week 6/8) |

AGENTS.md's ADR-005 freezes both god routers' *size* ("no new domains in the
two mega-files") but does not itself shrink them - that reduction is this
week's job.

## Extracted this week

| Route | New home | Notes |
|---|---|---|
| `GET /transfers/list` | `routes/transfers.ts` → `lib/repositories/transfer-repository.ts` | First Transfer extraction. |
| `POST /transfers` | `routes/transfers.ts` → `lib/transfer-command-service.ts` → `lib/reservation.ts` (Week 7) | Behavior unchanged - reservation, validation, audit, rollback-on-failure all identical to the pre-extraction inline handler. |
| `GET /branches` | `routes/branches.ts` → `lib/branch-service.ts` | Migrated from the retired `foundation.ts` (unique, no live equivalent existed). |
| `POST /webhooks/marketplaces/:connectorId` | `routes/marketplace-webhook.ts` → `lib/channel-ingest.ts` | Moved out of `index.ts` (guide Week 15). Signed-HMAC credential, no bearer token. SKU/location resolution now scoped to the connector's company; every outcome audited with a payload checksum. Test: `routes/marketplace-webhook.test.ts`. |
| `POST /branches` | same | |
| `PATCH /branches/:id` | same | |
| `POST /branches/:id/archive` | same | Bug fixed while porting: the archive-guard's stock check now reads `StockLedger` (live) instead of `StockBalance` (dead since ADR-001's Week 6 addendum) - see `lib/branch-service.ts`'s header comment. |

5 of `core.ts`'s 93 routes and all of the unique surface from `foundation.ts`
are extracted. This is a first, fully-proven slice (parity tests, an
authorization-coverage test extended to cover the new routers, a real
Postgres bug fix caught in the process) - not the finish line the guide's
"do not start next week until" gate describes. See Backlog below.

## `foundation.ts` parity decision (full accounting)

| Route(s) | Verdict | Disposition |
|---|---|---|
| `/branches` (4 routes) | Unique | **Migrated** to `routes/branches.ts` (above). |
| `/stock-movements`, `/stock-movements/:id/reverse`, `/stock-balance` (4 routes) | Superseded + prohibited pattern | **Retired.** Wrote directly to `StockMovement`/`StockBalance`, exactly the pattern `architecture-lint.mjs`'s `direct-stock-write` rule blocks going forward; live path is `lib/inventory-posting-service.ts` (Week 6). |
| `PATCH /lots/:id/status` | Superseded | **Retired.** Identical path already live in `operations-extension.ts:256`. |
| `/expiry-alerts` GET, `PATCH /expiry-alerts/:id` (2 routes) | Superseded | **Retired.** `operations-extension.ts` has a richer live equivalent (`/expiry-alerts`, `/expiry-board`, `/expiry-write-off`, `/expiry-alerts/:id/status`). |
| `/work-assignments` (5 routes) | Unique | **Backlog.** No live equivalent; genuinely new functionality (not a bug fix), so deferring it doesn't leave anything broken. Needs its own service module before mounting. |
| `/import-templates` (3 routes) | Unique | **Backlog.** Same reasoning as work-assignments. |
| `/import-batches`, `/import-batches/:id/errors`, `PATCH /import-batches/:id/status` (3 routes) | Likely superseded by `core.ts`'s `/imports/batches` family, but field-level parity was not diffed this week | **Backlog - needs a real diff before a retire/migrate call**, not a guess. |
| `/lot-allocation/preview`, `/lot-allocation/manual` (2 routes) | Unique | **Backlog.** Ties into `lib/warehouse-workflow.ts`'s `allocateLots`, already used live elsewhere for transfer picking - a real future extraction candidate, not started this week. |

The file itself (`routes/foundation.ts`) is deleted - `git log` retains its
history if the backlog items above are ever migrated. Its own header
already called it a "sketch," so retiring the superseded/prohibited routes
outright (rather than keeping them present-but-unmounted) removes a
standing temptation to accidentally mount them.

## Remaining `core.ts` extraction backlog (Transfers)

| Route(s) | Line(s) (before this week's edit) | Notes |
|---|---|---|
| `PATCH /transfers/:transferId`, `DELETE /transfers/:transferId` | 1715, 1757 | Uses `canModifyTransfer`/`EDITABLE_TRANSFER_STATUSES`, still local to `core.ts` - extracting these next also means extracting those two helpers. |
| `PATCH /transfers/:transferId/status`, `POST /transfers/:transferId/confirm` | 1832, 3189 | Status-lifecycle routes - natural next slice, already backed by `lib/transfer-lifecycle.ts`. |
| `POST /transfers/:transferId/receive` and its QC/quarantine interaction | 3410 | The largest single handler in the Transfer surface; highest risk to move mechanically, most valuable to eventually service-ify. |
| ~~`POST /transfers/:transferId/evidence`, evidence GETs~~ **Extracted in Phase 4** to `routes/transfer-evidence.ts` (see `docs/phase4-architecture-db.md`) | 3683, 3703, 3715 | Thin wrappers around `lib/transfer-evidence.ts` - low-risk future extraction. |
| `GET /transfers/reprint-audit/all`, `GET /transfers/:transferId/reprint-audit`, `GET /transfers/:transferId/label`, `GET /transfers/:transferId/export.xls` | 3355, 3363, 3374, 3234 | Read-only reporting endpoints - low-risk. |
| Pick waves, picker tasks, replenishment-actions, transfer import preview/commit (11 routes) | 1774, 1888-2020, 2966-2983, 3016-3080, 3736-3754 | Warehouse-picking sub-flow; arguably its own bounded context (Warehouse) rather than Transfer proper - worth re-classifying, not just moving, when picked up. |

**22 of 27** `core.ts` Transfer routes remain (plus `operations-extension.ts`'s
one pick-wave-scan route). None were touched this week beyond the two
extracted; their behavior, and the shared local helpers they depend on
(`accessContext`, `canModifyTransfer`, `firstParam`, etc.), are unchanged.

## `core.ts` and `operations-extension.ts` Inventory routes - not started

33 Inventory-domain routes in `core.ts` (items, lots, stock counts,
adjustments, imports, photos, reports) and 20 in `operations-extension.ts`
(lots status/expiry, bins, putaway, serials) are cataloged but **not
extracted this week**. `lib/repositories/item-repository.ts` (ADR-002,
Week 4) is the one repository already scoped and ready to back an
`routes/inventory.ts` extraction; that is the recommended next slice after
finishing Transfers, since the repository work is already done.

## `core.ts` / `operations-extension.ts` OTHER routes - out of this week's named scope

66 routes in `core.ts` (permissions, users, locations admin, industries,
workspace, runtime/config, company, imports/batches, sync-status,
dashboard, audit, export) and 67 in `operations-extension.ts` (asset
checkouts, jobs, comments, notifications, intelligence, webhooks, Orders,
Returns, approval rules, tolerance/evidence rules, QC templates/inspections,
exceptions, mobile home, SaaS admin, connectors) are untouched. The guide's
Week 8 scope names Inventory and Transfers specifically; these are real
future weeks' bounded contexts (Orders, Returns, Warehouse, Identity,
Reporting per ADR-005's naming), not silently forgotten.

## What "thin route → service → policy → repository" means for the two extracted modules

- **Transfers**: `routes/transfers.ts` (route, ~70 lines) →
  `lib/transfer-command-service.ts` (command service, owns validation +
  reservation + persistence + rollback orchestration) →
  `lib/reservation.ts` (Week 7's atomic primitive) and
  `lib/repositories/transfer-repository.ts` (read-side, `AccessContext`-typed).
  Domain policy: `lib/transfer-lifecycle.ts`'s `canCreateTransfer` (unchanged,
  reused).
- **Branches**: `routes/branches.ts` (route) → `lib/branch-service.ts`
  (command service, owns the archive-guard's cross-table check) → direct
  Prisma (no dedicated repository yet - Branch has no companyId-scoping
  question the way Item/Transfer do, since it's already a company-wide
  admin resource; a repository layer here would be ceremony without benefit
  today).

## Contract, generated clients, and deployment

See `contracts/openapi.json` (versioned 2026.8.0), `contracts/generated/`
(typed client + types, regenerated via `npm run contract:generate`, drift-
checked in CI via `npm run contract:check-drift`), and the "Deployment
proof" section of AGENTS.md's Week 8 addendum for the `api/dist` decision
(kept committed - see reasoning there).
