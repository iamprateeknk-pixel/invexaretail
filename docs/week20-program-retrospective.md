# Week 20: retrospective and repository health check

## Scope note

Week 20 is the last week of the 20-week execution guide. As with Weeks
12-19, the guide's own text was never recoverable from this repo (a full
git-history search in Week 12 found it was never committed here, and
nothing in the 15+ commits since has surfaced it). Rather than invent a
final feature under that same uncertainty, this closing week does two
things a 20-week program's last week should honestly do regardless of
what the guide's own text said: **verify the whole repository is actually
in the state every prior week's commit claimed**, and **consolidate what
20 weeks of work actually shipped versus what remains backlog**, in one
place, instead of scattered across 20 separate per-week docs.

## Full repository health check (run this week, all green)

- `api/`: `npm run build` (Prisma generate + `tsc`) - clean.
- `api/`: `npm test` (memory mode) - 561 passing, 0 failing, 66 skipped
  (the skipped tests are the real-Postgres suites, which require
  `TEST_DATABASE_URL` and are not meant to run in memory mode).
- `api/`: `node scripts/architecture-lint.mjs` - 123 tracked baseline
  violations (documented, non-blocking), 0 new.
- `api/`: `npm run contract:validate` / `contract:check-drift` - both pass.
- `web/`: `npm test` - 107 passing, 0 failing.

Every real-Postgres integration test suite added across Weeks 11, 12, 14,
17, and 19 (`import-commit-service.postgres.test.ts`,
`reporting-repository.postgres.test.ts`, `outbox-retention.postgres.test.ts`,
and the tenant-scope negative tests layered into the reporting suite) was
re-run against a live Postgres instance as part of this week's check, not
just re-confirmed via memory mode. All passing.

## What 20 weeks actually shipped

- **Weeks 1-10** (prior sessions, summarized from AGENTS.md's Architecture
  decisions section - not re-verified line-by-line this week, but their
  tests are part of the 561 passing above): the Postgres migration, ADR-001
  through ADR-006, the canonical `InventoryPostingService`, the ADR-002
  repository pattern (`Item` as reference), rotating refresh sessions
  (ADR-003), the `core.ts`/`operations-extension.ts` god-router extraction
  started (Transfers, Branches), the Week 9 web UX foundation
  (`lib/permissions.js`, shared feedback components, the JSX test
  toolchain), and Week 10's item search / stock detail vertical slice.
- **Week 11**: the staged import lifecycle (`lib/import-commit-service.ts`)
  - a full state machine with checksum dedupe, checkpoint-based crash-safe
  resumability, and per-import-type commit policy, proven against a
  5,000+ row golden dataset.
- **Week 12**: the Reporting bounded context (`lib/reporting-repository.ts`)
  - the exception-first dashboard ADR-005 named and Week 10 deferred,
  built with an explicit, documented "at risk"/SLA decision per queue.
- **Week 13**: closed the OpenAPI contract debt Weeks 11-12 left open.
- **Week 14**: investigated and closed the `startOutboxWorker`-never-wired
  gap - found there was no real consumer to wire it to, and fixed the
  actual bug (`DomainEventOutbox` unbounded growth) instead of forcing a
  fake one.
- **Weeks 15-16**: machine-checked the two lint follow-ups AGENTS.md had
  named since Week 4/7 (`unscoped-tenant-query` widened past Item-only,
  `bare-status-write` added from scratch) - and in doing so, surfaced real,
  previously-invisible gaps (85 + 6 pre-existing violations) rather than
  quietly patching or hiding them.
- **Week 17, 19**: started actually fixing the tenant-scope gap Week 15
  surfaced - `PurchaseOrder` and `Order` each got a real `companyId`
  column, backfilled, wired into every create call site, and simplified
  `reporting-repository.ts`'s queries to use it directly.
- **Week 18**: archived the legacy `backend/` prototype after a real
  parity check (guide-named, not inferred - the one week in this range
  where this repo's own text gave a concrete instruction).

## What remains backlog, honestly

This is the accounting a last week owes, not a victory lap:

- **No import-wizard or dashboard UI.** Both Weeks 11 and 12 shipped
  backend-only; `web/` has no screens for either yet.
- **Tenant-scope migration is 2 of 5 models done.** `Transfer`,
  `StockCount`, `ExpiryAlert` are still `tenantId`-only. `Transfer` in
  particular needs its own investigation first - Week 19 found its
  creation path (`lib/repository.ts`'s `createTransferRecord`) is purely
  in-memory and never calls Prisma, so how a transfer actually reaches
  `StockLedger` in database mode is unclear and needs answering before a
  companyId migration there is safe.
- **`unscoped-tenant-query`'s 99 tracked violations and `bare-status-write`'s
  6 are not fixed**, only made visible. The bulk of the former is
  `routes/operations-extension.ts` - the same god-router Week 8 started
  extracting from and has 175+ routes still left in it per
  `docs/route-ownership-matrix.md`.
- **`lib/outbox-worker.ts`'s retry/POISON machinery is fully built,
  fully tested, and has no consumer.** Correctly left unwired (Week 14's
  finding), but that means it's dead code today - worth deleting or
  finally giving it a real purpose if one ever materializes, rather than
  carrying it forward indefinitely.
- **The Float->Decimal migration** (`docs/decimal-migration-plan.md`,
  prepared since Week 5) has never been executed. 17 tracked `float-money`
  violations remain in the schema.
- **`admin-panel/`'s design-token consolidation** onto Week 9's token set
  is still an open gap.
- **The execution guide document itself was never found.** Every week
  from 12 onward was inferred from this repository's own named gaps and
  documented as such, rather than implemented from the guide's actual
  words. If the guide exists somewhere outside this repository, comparing
  it against this document and the per-week docs it links would be the
  natural next step for whoever picks this up - to check what was
  correctly inferred, what was missed, and what this session simply
  couldn't have known to build.

## Where to look next

`docs/route-ownership-matrix.md` (god-router extraction backlog),
`docs/tenant-scope-coverage.md` (the tenant-scope migration's per-model
status), and `docs/inventory-posting-coverage.md` (baseline
`InventoryPostingService` call sites not yet migrated) are the three
living tracking documents this program leaves behind - each names its own
honest remainder, not just what shipped.
