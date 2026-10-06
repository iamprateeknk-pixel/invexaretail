# Phase 6: performance and deployment

Measured on a local Postgres 17 (Docker) with a synthetic dataset: 1 company,
30 locations, 6,000 items, 180,000 `StockLedger` rows and 60,000 transfers.
These are development-machine numbers (the API ran under `tsx`), useful for
before/after comparisons, not as production capacity claims.

## Found and fixed

1. **Startup hydration crashed at scale (the important one).**
   `persistence.ts` loaded the in-memory repository with
   `array.splice(0, array.length, ...rows)`. Spreading puts every row in the
   call's argument list, and V8 throws `RangeError: Maximum call stack size
   exceeded` at roughly 120,000 elements. With 180,000 stock rows hydration
   failed, every operational request answered `503 Inventory is starting`, and
   it never recovered (observed for 4+ minutes). Fixed in 14 places with
   chunked helpers (`lib/array-utils.ts`: `replaceContents`, `pushAll`);
   the same database now hydrates and serves requests **5 seconds** after start.
   `array-utils.test.ts` proves the spread form overflows at 400,000 rows and
   the helpers do not.
2. **Sequential scans on hot queries.** `EXPLAIN ANALYZE` before and after
   (migration `20261112090000_hot_query_indexes`, additive):

   | Query | Before | After |
   |---|---|---|
   | Stock list for one location (`StockLedger(locationId, itemId)`) | 19.6 ms | 1.8 ms |
   | In-transit transfers to a destination (`Transfer(destinationLocationId, status)`) | 6.3 ms | 0.09 ms |
   | Transfers from a source, newest first (`Transfer(sourceLocationId, createdAt)`) | 4.0 ms | 0.12 ms |
   | Expiring lots (`Lot(expiryDate)`) | 1.5 ms | 0.4 ms |

   A `Transfer(companyId, status)` index was tried and dropped (7.7 to 6.0 ms
   because a third of rows match): not worth its write cost on a hot table.
   Only one index was added to `StockLedger`, the most write-heavy table.
3. **No response compression.** Added `compression` (`lib/response-compression.ts`)
   with a 1 KB threshold. An item-search page went from 1,995 to 458 bytes
   (-77%). Server-sent events are explicitly excluded (compression buffers, so
   live events would arrive in bursts); tested.
4. **Per-IP rate limit was hard-coded at 240/min.** A store or warehouse behind
   one NAT address can hit that together, and it made load testing impossible.
   Now `API_RATE_LIMIT_PER_MINUTE` (default unchanged, capped at 1,000,000,
   garbage falls back to the default).
5. **Web: one 559 KB entry chunk.** Every page except the dashboard is now a
   lazy chunk with a loading state. Entry chunk 559 KB to 355 KB raw
   (-37%); each page loads when first opened.

## Load probe

`npm run load:test` (`scripts/load-test.mjs`, no dependencies): signs in, drives
each endpoint with N concurrent workers, prints p50/p95/p99, exits non-zero on
error rate or an optional `--p95-budget-ms`. Baseline run (10 concurrent, 8 s each,
dev server, 180k-row database):

| Endpoint | rps | p50 | p95 | p99 |
|---|---|---|---|---|
| `GET /items/search?limit=25` | 214 | 44 ms | 63 ms | 95 ms |
| `GET /transfers/list` | 79 | 120 ms | 186 ms | 237 ms |
| `GET /reports/dashboard` | 74 | 130 ms | 167 ms | 189 ms |
| `GET /reports/exceptions` | 159 | 43 ms | 64 ms | 84 ms |

Zero errors. The demo admin belongs to a different company than the synthetic
data, so these mostly measure request overhead (auth, tenant scoping, the
stale-snapshot refresh check), not large result sets.

## Release checklist (staging)

1. `npm run db:migrate && npm run db:verify` against staging (Render runs both as
   `preDeployCommand`).
2. `API_URL=<staging> LOAD_PASSWORD=<...> npm run load:test -- --duration 30
   --concurrency 20 --p95-budget-ms 500`, with `API_RATE_LIMIT_PER_MINUTE`
   raised on staging only.
3. Confirm `GET /ops/metrics` shows `slo.breached: false` (outbox lag, poison rows).
4. Set `TOTP_ENCRYPTION_KEY` if two-factor should be offered (Phase 5).
5. Web: `npm run build`; confirm no chunk-size warning.

## Not done

- The API serves operations from an in-memory snapshot of the whole inventory,
  loaded at start. Hydration is now safe at 180k rows, but memory and startup
  time still grow with data; a database-first read path is a larger project.
- No CDN/HTTP caching for API reads, no OpenTelemetry collector (the opt-in
  exporter in `lib/telemetry.ts` is untouched), and no sustained soak test.
- The load probe is not run in CI: it needs a seeded, hydrated server and
  credentials. Its statistics are unit-tested in CI.
