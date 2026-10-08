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
