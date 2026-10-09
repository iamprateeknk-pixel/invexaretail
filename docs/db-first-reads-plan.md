# Database-first reads: where it stands and how to do it safely

Tracker row A: "Database-first reads, drop in-memory snapshot" - **open, deliberately not started in code.**
This note records why, measures the work, and fixes the order so the next person can start without redoing the survey.

## What the snapshot is

In database mode the API still answers most reads from process memory (`lib/repository.ts`: items with lots,
locations, stock ledger, counts, transfers, daily movements, ...). It is loaded at start by hydration
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
