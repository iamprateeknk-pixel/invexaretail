# Week 12: Reporting bounded context - exception-first dashboard

## A note on scope

This week's scope is **inferred, not extracted from the execution guide**.
A prior session's subagent searched the repo's full working tree and its
entire git history for the guide document (checked for `.docx`/`.md`/`.pdf`
files, filenames containing "execution"/"guide"/"roadmap"/"blueprint"/"week",
and grepped for "WEEK 12"/"Week 12" across everything ever committed) and
could not find it - it has never been checked into this repository. AGENTS.md
and prior weeks' commit messages only paraphrase or reference the guide by
week number; they never reproduce a task block verbatim.

Rather than fabricate Week 12's requirements, this week instead builds two
things this repo's own documentation already names as outstanding:
ADR-005's "Reporting" bounded context (named, never built), and Week 10's
explicitly-deferred exception-first Dashboard (`docs/week10-item-search-stock-detail.md`:
*"building one honestly needs a product decision on what 'at risk' and 'SLA'
mean per queue, which this week did not make unilaterally"*). That decision
is made this week, explicitly, below - not silently assumed.

## The product decision: what "at risk" and "SLA" mean

| Concern | Definition this week | Why |
|---|---|---|
| Exception breach | `ExceptionCase.dueAt` is set, in the past, and `status` is still OPEN/IN_PROGRESS/PENDING_APPROVAL | `dueAt` already exists on the model precisely for this. |
| Stock risk - stockout | A `StockLedger` row with `onHand <= 0` | Direct, unambiguous. |
| Stock risk - quarantine | A `StockLedger` row with `quarantine > 0` | Stock pending a QC/exception disposition it hasn't gotten yet. |
| Stock risk - expiry | An `ExpiryAlert` row with `status = ACTIVE` | The model already exists and already carries this state. |
| Stock risk - "will stock out soon" | **Not implemented.** | No reorder-point/min-stock/safety-stock field exists anywhere in the schema. Projecting future stockouts without one would be guessing a threshold nobody set - explicit backlog, not a fabricated number. |
| Transfer queue SLA | Non-terminal status, age since `createdAt` > 48h (`TRANSFER_SLA_HOURS`) | Transfer has no due-date field in the schema. |
| Purchase Order queue SLA | Open status (APPROVED/SENT/PARTIALLY_RECEIVED), `expectedAt` in the past | Real due-date field already exists. |
| Order queue SLA | Open status (RESERVED/BACKORDERED), `estimatedDispatchAt` in the past | Real due-date field (promise engine) already exists. |
| Return Request queue SLA | Open status (REQUESTED/APPROVED), age since `createdAt` > 72h (`RETURN_SLA_HOURS`) | ReturnRequest has no due-date field. |
| Stock Count queue SLA | `reviewStatus` PENDING_REVIEW/RECOUNT, age since `countDate` > 24h (`STOCK_COUNT_REVIEW_SLA_HOURS`) | StockCount has no due-date field on itself (the related `CountAssignment.dueDate` exists but joining it is deferred - see Not done). |

The three fixed-hour thresholds are named constants in
`lib/reporting-repository.ts`, not magic numbers - they are this week's
judgment call, changeable without touching query logic.

## Shipped

- **`lib/reporting-repository.ts`**: `getExceptionQueueSummary`,
  `listOpenExceptions` (cursor-paginated, Week 10's `{items, nextCursor}`
  shape), `getStockRiskSummary`, `getQueueBacklogSummary`,
  `getDashboardSummary` (the combined read model). Every export takes a
  required `TenantContext` (ADR-002).
- **`routes/reports.ts`**: `GET /reports/dashboard`, `GET
  /reports/exceptions`. Additive - the pre-existing `/reports/transfer-cycle`,
  `/reports/count-accuracy`, `/reports/audit-export`
  (`routes/command-center.ts`) and `/companies/:companyId/dashboard/summary`
  (`routes/enterprise-analytics.ts`) are untouched.
- **A genuine tenant-isolation fix**: `ExceptionCase` - the existing
  cross-module exception inbox (blueprint Module H) - had **no scoping
  column at all** before this week, not even the usual constant `tenantId`
  every other pre-ADR-002 model at least has. Any existing code querying it
  already had zero tenant isolation. It now carries a real `companyId`
  (migration `20261008090000_exception_case_company_scope`), and this
  week's queries filter on it directly.
- **A pragmatic scoping pattern for the rest**: `Transfer`, `PurchaseOrder`,
  `Order`, `StockCount` and `ExpiryAlert` still only carry the constant
  `tenantId` (unchanged this week - migrating five models' schemas is out
  of scope for a reporting module). Each of those does have a `Location`
  relation, and `Location` does carry a real `companyId` - so this week's
  queries scope through that join (`companyLocationIds` in
  `reporting-repository.ts`) instead of trusting the constant `tenantId`.
  `ExceptionCase` couldn't use this trick safely because its `locationId` is
  optional - a case with no location would fall outside any location-based
  scope entirely, which is exactly the gap that got the real `companyId`
  column instead.
- **Testing**: `api/src/lib/reporting-repository.postgres.test.ts` (real
  Postgres, 5/5 passing) covers exception status/priority grouping and
  breach detection (a closed case past its `dueAt` must not count as
  breached), cursor-paginated soonest-due-first ordering, stock-risk
  counting, all five queue backlogs' pending/breached counts, and dashboard-
  wide tenant isolation. `route-auth-coverage.test.ts` extended to cover the
  new router.

## Not done (explicit backlog)

- **No frontend.** This is backend-only - no dashboard UI was built in
  `web/`.
- **No "will stock out soon" projection.** Needs a reorder-point/min-stock
  field this schema doesn't have yet.
- **`StockCount`'s real per-assignment due date (`CountAssignment.dueDate`)
  is not joined.** The backlog metric uses a fixed age-since-`countDate`
  threshold instead, for the same reason Transfer/ReturnRequest do -
  simpler, though less precise where an assignment's own due date exists.
- **The four other domain models' `tenantId`-only scoping is not fixed.**
  Only `ExceptionCase` (the one with no scoping at all) was migrated this
  week. `Transfer`/`PurchaseOrder`/`Order`/`StockCount`/`ExpiryAlert`
  remain the same pre-ADR-002 baseline gap AGENTS.md's Tenant scope row
  already names for Identity/Organization - this week's location-join
  workaround makes *this module's* queries safe, but does not change the
  underlying tables or any other code's queries against them.
- **Priority is not a secondary sort key in `listOpenExceptions`.** Pages
  are ordered by `dueAt` only (soonest first, nulls last); true priority
  ordering needs a raw-SQL `CASE` (Prisma can't express the
  CRITICAL > HIGH > MEDIUM > LOW severity order via a plain enum sort,
  since it isn't alphabetical) - deferred rather than silently wrong.
- **`contracts/openapi.json` has not been extended** with the two new
  `/reports/*` paths - same immediate-follow-up gap Week 11 left for its
  own new routes, not yet closed for either.
