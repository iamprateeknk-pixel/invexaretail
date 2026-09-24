# Closing three "Partial/Incomplete" execution-guide gaps

Three items were flagged as partially done against the recovered 20-Week
Developer Execution Guide. This closes what was safely verifiable in this
session (pure functions, existing logic, CI wiring) without inventing
schema migrations or infrastructure this repo doesn't have.

## 1. Week 12: stock-count fair-assignment acceptance examples were never directly asserted

`lib/stock-take-campaign.ts`'s `planDailyAllocation` (a real, deterministic,
least-loaded-with-tie-break allocator, already wired into
`campaign-service.ts`'s `runCampaignDay`) existed and had general-shape
tests, but the guide's two named acceptance numbers were never directly
checked:

- "100 products/3 users without a daily cap distributes 33, 33 and 34"
- "With daily cap 20, day/batch one assigns 20/20/20, next assigns
  20/20/20 ... with no duplicate or missing product"

Added both as explicit tests in `stock-take-campaign.test.ts`. Both pass
against the existing algorithm unchanged - this was a test-coverage gap,
not a code defect. The guide's further "final 10/10 go to two users"
wording is not a property of `planDailyAllocation` itself for 3 equally
available users (the honest math for 20 remaining items over 3 users is
7/7/6, which the new test asserts and explains); that phrasing describes a
user going unavailable that day, a separate scenario already covered by
`reassignWorkload`/`cancelOpenAssignments`.

## 2. Week 15: marketplace-order idempotent replay had no real-Postgres proof

`lib/orders.ts`'s `createOrderWithReservation` already implements the
guide's exact requirement - "Same marketplace order replayed twice creates
one order and one reservation" - via `findOrderByExternalReference` plus an
in-process `ingestLocks` promise-chain that serializes concurrent replays
for the same `channel + externalReference` key. `orders.memory.test.ts`
already proved this thoroughly in memory mode, including a genuine
concurrent-replay case. What was missing, per AGENTS.md's own rule that
anything touching stock reservation needs real-Postgres coverage: no
Postgres-backed proof existed. Added
`lib/orders-idempotent-replay.postgres.test.ts` - sequential replay (one
Order row, stock debited once) and concurrent replay
(`Promise.allSettled`, one Order row survives the race).

**Honest gap found, not fixed**: idempotency here rests entirely on an
in-process lock plus a `findFirst` check - correct for a single Node
process, but not correct across multiple API replicas (Render/Railway can
run more than one). There is no database-level unique constraint on
`(channel, externalReference)` to make this safe under real multi-replica
concurrency. Fixing that needs a schema migration with a documented
backfill/reconciliation plan for any pre-existing duplicate rows (AGENTS.md's
own migration rule), which needs a real Postgres instance to rehearse
safely - this sandbox has neither `DATABASE_URL` nor `TEST_DATABASE_URL`
available to do that rehearsal. Recorded here rather than silently patched
or silently ignored, matching this repo's own stated convention.

## 3. Fourteen real-Postgres test files existed but never ran in CI

While looking for existing Postgres-backed proof for item 2, found that
`.github/workflows/ci.yml` only ever ran 8 of the repository's 22
`*.postgres.test.ts` files as explicit steps. The other 14 - including the
**entire bare-id tenant-scope remediation's proof suite** (nine files
across nine separate slices, several of which AGENTS.md names as "the
reference" implementation for a required-tests rule), the Week 11 staged-
import lifecycle test, the Week 12 reporting-repository test, the Week 14
outbox-retention test, and this session's own new opening-stock-expiry and
outbox-health tests - only ever ran if a developer manually set
`TEST_DATABASE_URL` on their own machine. CI's own `postgres` service
container and `DATABASE_URL` were sitting right there unused for all of
them.

Added CI steps for all 14 previously-unwired files (plus the two new files
from items 1-2 above don't need Postgres, and the new
`orders-idempotent-replay.postgres.test.ts` from item 2, which does).
This is a pure CI-configuration change - no test code was altered to make
this happen - but it is a real, significant fix: dozens of tests this
repo's own documentation cites as load-bearing proof were not actually
being checked on every PR, only ever having been run once, by hand, at the
time each was written.

This carries real risk of surfacing genuine drift: any of these 14 files
could have silently stopped matching current schema/code since they were
last run by hand, and CI running them for the first time in a long while
may find real failures unrelated to anything in this PR. That is the
correct outcome of this change, not a sign it was wrong to make - such a
failure will be diagnosed and fixed like any other CI failure, not treated
as a reason to leave the gap in place.

## Testing

- `npm test`: 569 passing, 0 failing, 109 skipped (three more Postgres
  tests than before this session, all correctly skipped without
  `TEST_DATABASE_URL` in the default run).
- `architecture-lint`: 0 new violations.
- `contract:validate`/`contract:check-drift`: both pass.
- The 14 newly-wired CI steps, and the new
  `orders-idempotent-replay.postgres.test.ts` step, could not be verified
  against real Postgres in this sandbox (no `DATABASE_URL`/
  `TEST_DATABASE_URL` available here) - they depend on this PR's own CI
  run (which does have a real `postgres:17` service container) to prove
  out, the same "trust CI, don't claim done until CI green" pattern used
  for this session's earlier mobile crypto change.
