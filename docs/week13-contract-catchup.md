# Week 13: OpenAPI contract catch-up for Weeks 11 and 12

## Scope note

Same situation as Week 12: the execution guide's Week 13 task text is not
checked into this repo and could not be located (see
`docs/week12-reporting-exception-dashboard.md`'s scope note for the search
that established this). Rather than fabricate a task block, this week pays
down a debt both Week 11 and Week 12 explicitly named as "immediate
follow-up" and left open: `contracts/openapi.json` never got their new
routes.

This is a small, bounded week by design - closing two named, testable gaps
rather than inventing new speculative scope on top of an already-uncertain
guide situation.

## Shipped

- `api/contracts/openapi.json` bumped to `2026.13.0`, with:
  - Six new paths for Week 11's staged import lifecycle:
    `POST /imports/staged/batches`, `GET /imports/staged/batches/{id}`,
    `POST .../validate`, `POST .../commit`, `GET .../failures`,
    `POST .../reverse`.
  - Two new paths for Week 12's reporting dashboard:
    `GET /reports/dashboard`, `GET /reports/exceptions`.
  - New schemas: `ImportBatch`, `ImportRawRow`,
    `ImportBatchCreateRequest`/`Response`, `ImportValidationSummary`,
    `ImportFailedRow`, `ExceptionQueueSummary`, `ExceptionListItem`/`Page`,
    `StockRiskSummary`, `QueueBacklog`/`Summary`, `DashboardSummary`.
- `contracts/generated/types.ts` regenerated (`npm run contract:generate`).
- `contracts/generated/client.ts`'s typed wrapper extended with `imports.*`
  and `reports.*` namespaces, following the existing pattern (`items.*`,
  `branches.*`, `transfers.*`).
- `npm run contract:validate`, `contract:check-drift`, and
  `contract:typecheck` all pass. Full `npm test`: 561 passing, 0 failing.
  `architecture-lint`: 0 new violations.

## Not done

- Nothing else this week - deliberately scoped to just the contract
  catch-up. The other standing gaps this repo's docs name (no import-wizard
  UI, no dashboard UI, `lib/outbox-worker.ts`'s `startOutboxWorker` still
  unwired, the `tenantId`-only baseline on `Transfer`/`PurchaseOrder`/
  `Order`/`StockCount`/`ExpiryAlert`) remain exactly as documented in Weeks
  11 and 12 - untouched, not silently resolved.
