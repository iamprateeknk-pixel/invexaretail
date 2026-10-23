# Real-time user issues audit

What was found, fixed and left open when auditing live updates, double submits and sync.

## Fixed
- API did not compile (mangled `control-plane*.ts` facade, missing `await`s in `core-counts.ts`/`core-imports.ts`).
- `/events`: stream slot + timer leak when a client disconnected during replay; total cap never applied in database mode; a cursor ahead of the table now sends `reset`; per-stream 1 s queries are gated by one shared latest-id read.
- Web live client: refreshes the access token once on a 401 (previously stopped for good after sleep/background); no longer restarts the stream on every token rotation (dropped events).
- Web writes: identical in-flight writes are coalesced (double-click) and every JSON write carries a stable `X-Mutation-Id`, reused on retry after a network/5xx failure (server: `lib/mutation-idempotency.ts`).
- Web: stale stock response after a branch switch is dropped.
- Mobile: a 409 with `Retry-After` (MUTATION_IN_PROGRESS) is retried, not shown as a conflict.
- Tests: nested-router walk in contract/auth sweeps; time-bomb FEFO dates; dropped `StockBalance`; moved admin-panel/handoff; jsdom `matchMedia`.

- Orders: correction to the earlier "no unique constraint" note (docs/week36): a global `(channel, externalReference)` unique index existed since init, so duplicates could not persist. The real defects were (1) it was global, so two companies receiving the same marketplace reference collided; now `(companyId, channel, externalReference)` (migration `20270126090000_order_external_reference_per_company`, additive, rehearsed on Postgres 16, schema diff empty); (2) a cross-replica race surfaced as a 500; `createOrderWithReservation` now treats P2002 as a replay and returns the winning order.

- All 83 `*.postgres.test.ts` files were run one by one against a local Postgres 16 (migrations applied, schema diff empty). 17 failed before; none were product bugs: tests still compared Prisma `Decimal` columns to numbers after the Float->Decimal migration, and one assumed a seeded `user-admin-1`. All fixed; 83/83 pass.

## Open
- Multipart uploads (evidence photos) are not covered by the web mutation-id/coalescing.
- The P2002 catch path itself has no automated test (needs two processes to race); the DB-level rejection and cross-company cases are tested in `orders-idempotent-replay.postgres.test.ts`.
- Mobile changes could not be run here (no Flutter SDK).
