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

## Open
- No DB unique constraint on `(channel, externalReference)`: duplicate marketplace orders are possible across replicas (needs a rehearsed migration).
- Multipart uploads (evidence photos) are not covered by the web mutation-id/coalescing.
- Mobile changes could not be run here (no Flutter SDK).
