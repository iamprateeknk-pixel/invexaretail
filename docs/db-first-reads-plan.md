# Database-first reads: where it stands and how to do it safely

Tracker row A: "Database-first reads, drop in-memory snapshot" - **in progress: slices 1-9 done (documents below), stock done as slices 10-11 (Phase 5); the remaining snapshot reads are document lists (transfers, counts) and the catalogue-adjacent joins, sequenced as follow-on work.**
This note records why, measures the work, and fixes the order so the next person can start without redoing the survey.

## What the snapshot is

In database mode the API still answers some reads from process memory (`lib/repository.ts`: items with lots,
locations, counts, transfers, daily movements, ...). Stock quantities are no longer among them (slice 10-11).
The snapshot is loaded at start by hydration
(`lib/persistence.ts`) and kept fresh by `lib/repository-reconciler.ts` (background reconcile; health at
`GET /ops/metrics` -> `reconciliation`). Mutations write Postgres first and then mirror into memory.

Costs: memory and start-up time grow with data; each replica holds its own copy, so a write on one replica is only
seen by the others after a reconcile.

## Size of the job (measured 2026-10-09, direct snapshot reads of the list/find functions)

| File | Reads |
|---|---|
| `routes/core.ts` | 81 |
| `routes/transfers.ts` | 14 |
| `lib/campaign-service.ts` | 12 |
| `routes/operations-extension.ts` | 10 |
| `routes/command-center.ts` | 10 |
| `lib/expiry-lifecycle.ts` | 6 |
| `lib/reorder-store.ts` | 5 |
| everything else | 1-4 each, 12 more files |

Most are synchronous (`listItems().find(...)` inside a handler or a pure helper). Moving a read to the database makes
it `async`, so every caller and every pure helper that takes the list as input changes shape. That is why this is a
re-architecture and not a find-and-replace.

## Why no code in this pass

1. **Each slice needs a memory-vs-Postgres parity test, and that helper does not exist yet.** It must run the same
   request against memory mode and against real Postgres and compare the responses (shape, ordering, rounding, nested
   `lots`). A local Postgres is available through Docker (see "Running the Postgres tests locally" below), so this is
   possible, but a slice without the helper would ship unproven. Earlier slices of this project were all proven
   against real Postgres (see `AGENTS.md` "Required tests").
2. **The failure mode is quiet.** A DB read that differs from the snapshot in ordering, a missing nested field, or
   `Decimal` serialised as a string does not crash; it silently changes what clients see.
3. **Half-done is worse than not done.** With some reads on the database and some on memory, one request can combine
   two different moments in time.

## Order to do it in (each slice = one PR, with a memory-vs-Postgres parity test)

1. **Read models that already have a database implementation**: `routes/items.ts` (`searchItems`, `getStockDetail`),
   `lib/reporting-repository.ts`, `lib/repositories/*`. Nothing to do except stop mirroring them.
2. **`GET /items` (full catalogue) -> `searchItems` pages.** Needs the web `useWorkspaceHydration` poll changed to
   page or to ask per screen first; otherwise it just moves the same amount of data.
3. **Stock reads** (`listStockLedgerForLocation`, `findStockLedgerEntry`): the largest memory user and the most
   write-contended, so do it with the posting service (`lib/inventory-posting-service.ts`) as the only writer.
4. **Counts / campaigns** (`lib/campaign-service.ts`, `core.ts` count routes).
5. **Transfers** (`routes/transfers.ts` after the extraction in PRs #101-#102; `lib/repositories/transfer-repository.ts`
   already exists as the read side).
6. **Remove the mirror and the reconciler** only when no handler reads memory any more; keep memory mode (tests,
   local) as a separate repository implementation behind the same interface.

## Running the Postgres tests locally

```bash
docker run -d --name invexa-ci-postgres -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=invexa_ci -p 5433:5432 postgres:17
# make a scratch database, migrate it, then run any *.postgres.test.ts file directly
export DATABASE_URL=postgresql://ci:ci@127.0.0.1:5433/invexa_local TEST_DATABASE_URL=$DATABASE_URL
npx prisma migrate deploy
npx tsx --test src/lib/passkey-store.postgres.test.ts
```

Run each file on its own, as CI does: running them together against one database shares state between tests.

## Gate before starting slice 1

- CI running the `*.postgres.test.ts` files again (blocked on GitHub Actions billing); locally the recipe above works.
- A parity-test helper that boots both modes and diffs JSON for a list of requests.

## Progress

- **Corrected survey (2026-10-09).** The 130+ figure counts every call site, including the memory-mode branch of
  handlers that already read Postgres when `databaseEnabled` (for example `GET /stock/:locationId`). Counting
  handlers instead: 55 handlers across the six route files read the snapshot, 28 of them mutating; of the 27 `GET`
  handlers, 22 have no database branch at all: `/locations`, `/items`, `/counts`, `/count-assignments(/mine)`,
  `/mobile/work`, `/cycle-counts/:locationId`, `/picker-tasks`, `/pick-waves/:id`, `/dashboard`, `/export/:type`,
  `/imports/history`, `/sync-status`, `/expiry-dashboard`, `/reports/variance/:locationId`, `/reports/:locationId`,
  `/picker/transfers/:transferId`, `/transfers/:transferId/export.xls`, `/command-center`,
  `/reports/transfer-cycle`, `/reports/count-accuracy`, `/transfers/by-package/:packageId`.
- **Slice 1 done: `GET /locations`** via `lib/repositories/location-repository.ts` (`listLocationsForCompany`, scoped by
  `TenantContext`, stable order). Parity and tenant isolation proven on real Postgres in
  `location-repository.postgres.test.ts`: the repository equals the hydrated snapshot for the same company, and a
  location created after boot is visible without hydration. The pattern for the next slices is the same: scoped
  repository function + a Postgres parity test against the hydrated snapshot.
- Next (single-entity, one or two reads each): `/items` (needs the web poll changed to page), `/counts`,
  `/count-assignments`, `/imports/history`.
- **Finding for the `/counts` slice (not yet done).** The snapshot's hydration (`lib/persistence.ts`) stamps every
  persisted count with `role: 'STORE_USER'` because the role of the submitter is not stored on `StockCount`; and the
  blind-count branch of `GET /counts` returns that field. A database-first read has to either reproduce that
  placeholder (parity, but knowingly wrong) or join the submitter's real role from `User` (correct, but a visible
  change to clients). That is a product decision for the slice owner, which is why `/counts` was not converted
  mechanically. Expect the same kind of decision wherever hydration fills a field the database does not hold.
- **Slice 2 done: `GET /imports/history`** via `lib/repositories/movement-repository.ts`. Besides moving the read to
  Postgres it removes a real limit: the snapshot kept only the newest 10,000 movements across *all* companies, so a busy
  company could push another's history out. Tenant isolation, ordering, the 500 limit and parity with the hydrated
  snapshot are proven in `movement-repository.postgres.test.ts`.
- **Slice 3 done: `GET /count-assignments`** (the admin list) via `lib/repositories/count-assignment-repository.ts`,
  scoped through the assignment's location. `GET /count-assignments/mine` and `GET /mobile/work` are not converted yet:
  they join each assignment with the item and its lots, so they wait for the `/items` slice.
- **Finding for the `/items` slice (not yet done).** Two things make it different from slices 1-3:
  1. *Mapping.* Hydration turns an `Item` row into an `ItemRecord` with ~30 field defaults and renames (`countMethod ??
     'LOT_SCAN'`, `status ?? 'ACTIVE'`, `mrp` Decimal to number, `aliases` JSON, nested `lots` with ISO dates).
     `item-repository.ts`'s `toItemRecord` is only a spread of the row, so it does not match. The right move is to
     extract the hydration mapper into one exported function used by both hydration and the repository, so parity is
     true by construction rather than by test.
  2. *Cost.* The web workspace poll reads the whole catalogue. Today that is a memory copy; database-first makes every
     poll a full-catalogue Postgres query (20k+ items with lots). The web side must page or ask per screen first
     (`useItemSearch` already exists), otherwise this slice trades memory for database load. That is a performance
     decision, so it is sequenced after the web change, not before.
- **Slice 4 done: `GET /sync-status`** via `lib/repositories/sync-checkpoint-repository.ts` plus the slice-1 location
  repository. Same pattern: scoped through the checkpoint's location; tenant isolation, SALES/PURCHASE-only and parity
  with the hydrated snapshot are proven in `sync-checkpoint-repository.postgres.test.ts`.
- **Slice 5 done: `GET /counts`**, taking the decision recorded above: the database-first read returns the submitter's
  *real* role (joined from `User`), not the hydration placeholder. Checked first that nothing consumes it: no code in
  `web/` or `mobile/` reads `count.role`; only the blind-count branch of this endpoint echoes it. The snapshot keeps its
  placeholder (so memory-mode and snapshot-based features are unchanged) and the parity test asserts everything else is
  equal. The row-to-record mapping moved into `lib/count-record-mapper.ts`, used by both hydration and the repository.
  If the product owner wants the old placeholder back, it is a one-line change in `count-repository.ts`.
- **Measured cost of the `/items` slice (2026-10-09, local Postgres 17, 20,000 items x 2 lots).** A full-catalogue read
  (`item.findMany` with `lots`) takes about 0.8-1.1 s, plus about 0.3 s to serialise a 24 MB body; the snapshot path
  today pays only the serialisation. So converting `/items` as it is would make the endpoint roughly 3-4x slower and put
  a ~1 s Postgres query behind every web poll. The 24 MB response is itself the underlying problem. The web app keeps
  the whole catalogue in state and loads it from 8 call sites (`useWorkspaceHydration`, `useWorkspaceExpiry`,
  `useWorkspaceImports`, `useWorkspaceStock`, `ItemMasterPanel` x3), so the real fix is paging/per-screen loading in
  the web app (`useItemSearch` / `GET /items/search` already exist), after which `/items` can go database-first at a
  few hundred rows per request. Until then `/items` stays on the snapshot on purpose.

- **Catalogue paging, step 1: a version gate instead of a rewrite.** Rather than paging 50 components, the web app now asks
  `GET /items/version` (two indexed aggregates: row counts plus newest `updatedAt` of items and lots, company scoped) and
  refetches the 24 MB catalogue only when the version moved. Safety polls and events that do not touch the catalogue (stock,
  counts, transfers) now cost one small query instead of the full read. This is what makes a database-first `GET /items`
  affordable: it only runs on real catalogue changes and at login. Memory mode returns `null` (unknown), so clients refetch
  as before. Proven in `item-catalogue-version.postgres.test.ts` (moves on item edit, lot edit, new/deleted item and lot;
  never moves for another company) and `web/src/lib/catalogue-version.test.js`. Next: switch `GET /items` itself to the
  database (mapping extraction, parity test) now that the polling cost is gone.
- **Slice 6 done: `GET /items`** (the full catalogue) via `listItemsForCompany` in `item-repository.ts`. The Item-row to
  ItemRecord mapping was extracted from snapshot hydration into `lib/item-record-mapper.ts`, so hydration and the
  repository share one function and the shape cannot drift; `item-list-repository.postgres.test.ts` proves tenant
  isolation and field-for-field parity with the hydrated snapshot (including an item with every optional column empty).
  This is affordable now because the web app only calls it when `GET /items/version` moved (previous step).
  Unblocked next: `/count-assignments/mine`, `/mobile/work`, `/dashboard`, `/cycle-counts/:locationId`, reports and exports,
  which all join the catalogue.
- **Slice 7 done: `GET /count-assignments/mine`** (a count worker's own open tasks with item name and code) via
  `listMyOpenAssignments` in `count-assignment-repository.ts`; the assignment-row mapping is now one function used by
  both list functions. In database mode the assignment's location must belong to the caller's company. Isolation and
  parity with the snapshot's assignment/item join are in `count-assignment-repository.postgres.test.ts`.
  `GET /mobile/work` is next: it also needs per-lot stock-ledger presence and incoming transfers, so it waits for the
  stock and transfer reads.
- **Slice 8 done: `GET /mobile/work`** via `lib/mobile-work.ts`. The response is built by one pure function
  (`buildMobileWork`) from loaded facts; only the loading differs by mode. Database mode asks Postgres for just this
  user's open assignments, those items with lots, the stock-ledger rows for those item/location pairs, and receivable
  transfers for the company, so it never loads the catalogue (phones poll this endpoint). Finding while doing it: the
  database's `TransferStatus` enum has `PARTIAL_RECEIVED` but not `PARTIALLY_RECEIVED`, which only exists in the
  in-memory type; the database query uses the real enum values. Parity with the snapshot, empty/blocked-lot filtering,
  and cross-company isolation are in `mobile-work.postgres.test.ts`.
- **Slice 9 done: `GET /picker-tasks`** via `lib/picker-tasks.ts`: `listPickableTransfers` loads the company's transfers that
  still need picking (Postgres in database mode), and `buildPickerTasks` is the pure access/assignment filter shared by both
  modes (a transfer assigned to another picker leaves a picker's queue; an admin sees all). Isolation, status filter,
  assignment rule and parity with the hydrated snapshot are in `picker-tasks.postgres.test.ts`.

- **Slice 10 done: every stock-quantity read (Phase 5, R1/R4).** All stock reads now go through
  `lib/repositories/stock-repository.ts` (`listStockForLocation`, `findStockEntry`, `listStockForCompany`,
  `listBinStockForLocation`, `listRecentMovementItemIds`, `listRecentMovements`), tenant-scoped in the query itself
  and dual-branch so memory mode (REQUIRE_DATABASE=false) keeps working off the snapshot through the same functions.
  Converted, in order: `GET /stock/:locationId` (the old `listStockFromDatabase` had no companyId filter at all -
  a cross-tenant exposure held back only by a route-level check; the function is deleted), bin-stock GET (it used
  to fall back to memory on empty BinStock and *seed bins inside the GET*; an empty BinStock now answers
  `{ bins: [] }`), `/dashboard` and `/expiry-dashboard`, `GET /intelligence` (the memory builder and the database
  branch disagreed on availability by exactly the reserved bucket - onHand 10 with reserved 4 reported 10 vs 6;
  the builder now takes the ledger as a parameter and mirrors the database branch's sellable math), picker detail /
  allocation preview / pick slips and the replenishment transfer, count book quantities and the cycle-count
  planner's recency signals (they read `repository.stockMovements`, which hydration never loaded, so the signals
  silently died on every restart - they now read the journal), campaign eligibility, the import planners and
  stock-take flows, the low-stock webhook check, the mobile-work snapshot loader and the expiry boards. The
  row-to-record mapping is one function (`lib/stock-ledger-mapper.ts`) shared by hydration and the repository, and
  the snapshot record type now carries reserved/inTransit/damaged. Parity, tenant isolation and post-boot
  visibility are proven in `stock-repository.postgres.test.ts` and `stock-characterization.postgres.test.ts`
  over a shared two-company fixture (`lib/repositories/stock-parity-harness.ts`).
- **Slice 11 done: stock mirror writes retired, hydration slimmed, StockBalance dropped.** Every DB-mode stock
  mutation is now exactly one canonical posting: the `adjustStockLedger` / `adjustQuarantineLedger` mirrors that
  used to trail the database writes in transfers, imports, returns, procurement, jobs and expiry are removed (or,
  in the dual-mode flows, guarded to memory mode only, where the snapshot is still the store). The enterprise
  repository's private write-only `stockLedger` array is gone. `StockBalance` - a second stock table with no
  writer and no reader - is retired (model, back-relations, tenant-table entry, one defensive `deleteMany`, and a
  `DROP TABLE` migration whose header carries the pre-deploy gate: `SELECT count(*) FROM "StockBalance"` must be
  0, else export as OPENING_STOCK history first). Hydration no longer loads StockLedger into the snapshot, so in
  database mode the snapshot holds no stock at all; the reconciler keeps refreshing the remaining document arrays
  and `/ops/metrics` reports on those. A closing census re-run over the converted clusters plus the plausible
  stock-touching files finds zero snapshot stock readers and zero DB-mode mirror writes outside verified
  memory-mode-only paths (the orders memory branch, the expiry write-off's memory flow). What remains on the
  snapshot by design: document reads (transfer/count lists and their joins) - the follow-on slices.
