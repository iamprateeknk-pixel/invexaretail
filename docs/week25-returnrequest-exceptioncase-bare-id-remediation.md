# Bare-id call-site migration, slice 3: ReturnRequest and ExceptionCase routes

## Scope

Continues the remediation slices 1 (Week 23, `Order` routes in
`routes/operations-extension.ts`) and 2 (Week 24, `PurchaseOrder` routes in
`routes/catalog-procurement.ts`). This slice: the `ReturnRequest` and
`ExceptionCase` call sites in `routes/operations-extension.ts`, plus the
one `ExceptionCase`-creation choke point (`lib/exceptions.ts`'s
`createExceptionCase`) that every route/service in the codebase funnels
through to open a case.

## The real vulnerabilities, not just a lint nag

- **`PATCH /returns/:id/status`**, **`POST
  /returns/:id/lines/:lineId/disposition`**, **`PATCH
  /returns/:id/refund`** each did `prisma.returnRequest.findUnique({ where:
  { id: req.params.id } })` with no company check, then acted on (approve/
  reject/receive/refund) whatever it found. An admin of one company given
  or guessing another company's return-request id could approve or refund
  it.
- **`GET /exceptions`** built its `where` scope from role and an optional
  `locationId` query param, but for a manager/auditor role with no
  `locationId` supplied, the scope was `{}` - **no tenant filter
  whatsoever**. Any manager/auditor of any company saw every company's
  exception cases (damage, shortages, QC failures, quarantine, etc.). The
  same class of complete-list-leak bug as Week 24's `GET
  /purchase-orders` finding.
- **`PATCH /exceptions/:id`** and **`POST /exceptions/:id/resolve`** both
  did `prisma.exceptionCase.findUnique({ where: { id: req.params.id } })`
  with no company check, then mutated (reassign owner/priority/status, or
  resolve-and-close-with-disposition) whatever it found.
- **`createExceptionCase()`** (`lib/exceptions.ts`) - the single function
  every `POST /exceptions` call and every internal case-opening call site
  (receiving discrepancies, transfer pack mismatches, pick exceptions, QC
  failures) goes through - **never set `companyId` on the row it created
  at all**. `ExceptionCase.companyId` has a schema default
  (`"default-company"`), so every exception case ever opened through this
  function, from any company, silently landed under the single
  default-company bucket instead of the reporting user's real company.
  This was a bigger, quieter version of the `GET /exceptions` bug: even
  once the list query is scoped, it was scoping against data that was
  never tagged correctly in the first place.

## What changed

- `PATCH /returns/:id/status`, `POST
  /returns/:id/lines/:lineId/disposition`, `PATCH /returns/:id/refund`:
  each `prisma.returnRequest.findUnique({ where: { id } })` changed to
  `findFirst({ where: { id, companyId: req.companyId ?? DEFAULT_COMPANY_ID
  } })`. A cross-tenant id now resolves to `null`, hitting the existing
  `if (!returnRequest) return 404` path.
- `GET /exceptions`: the `scope` object now always includes `companyId:
  req.companyId ?? DEFAULT_COMPANY_ID` in every branch (the `mine`
  branch, the manager/auditor branch with or without a `locationId`, and
  the plain-user branch).
- `PATCH /exceptions/:id`, `POST /exceptions/:id/resolve`: each
  `prisma.exceptionCase.findUnique({ where: { id } })` changed to
  `findFirst({ where: { id, companyId: req.companyId ?? DEFAULT_COMPANY_ID
  } })`.
- `lib/exceptions.ts`'s `CreateExceptionCaseInput` gained a required
  `companyId: string` field, and `createExceptionCase()`'s
  `prisma.exceptionCase.create()` now sets it explicitly instead of
  relying on the schema default. Every call site was updated to pass a
  real companyId:
  - `routes/operations-extension.ts`'s `POST /exceptions` (the caller's
    own `req.companyId`), its return-receiving disposition handler (the
    already-tenant-verified `returnRequest.companyId`), and its
    put-away/pick-exception paths in `routes/core.ts` (`req.companyId`).
  - `routes/transfer-logistics.ts`'s two pack-mismatch/pack-incomplete
    exception openers (`req.user!.companyId`).
  - `routes/catalog-procurement.ts`'s damage/excess-receipt exception
    openers on PO receiving (the already-tenant-verified `order.companyId`).
  - `lib/qc-inspection.ts`'s `recordQcInspection()` (threaded a new
    required `companyId` field through its own input type, set by its one
    caller in `routes/operations-extension.ts` from `req.companyId`).

## What's deliberately unchanged

- `prisma.returnRequest.update` calls that reuse `returnRequest.id` (or
  `.order`) already resolved through one of the fixed lookups above -
  safe by construction, same reasoning as Weeks 23/24's own re-fetches.
- `prisma.exceptionCase.update`/`updateMany` calls in the same request
  after a fixed `findFirst`, or scoped by `sourceDocument`/`sourceLineId`
  derived from an already-verified `returnRequest` - safe by construction.
- `GET /returns` (list by `orderId`), the item/transfer/expiry-alert bare-id
  call sites nearby in the same file, and `Supplier`'s missing tenant-scope
  column (Week 24) remain untouched - out of scope for this slice, still
  tracked in the lint baseline.

## Testing

`src/routes/operations-extension-returns-exceptions.postgres.test.ts` (real
Postgres, 7/7 passing), reusing the `withServer`/`makeFixture` harness
pattern from slices 1 and 2 rather than writing a new one:

- `PATCH /returns/:id/status` 404s on a cross-tenant id and confirms the
  return's status is genuinely unchanged afterward; the owning company's
  own action still succeeds.
- `PATCH /returns/:id/refund` 404s on a cross-tenant id.
- `GET /exceptions` only ever returns the caller's own company's cases.
- `PATCH /exceptions/:id` 404s on a cross-tenant id and confirms the
  case's status is genuinely unchanged afterward.
- `POST /exceptions/:id/resolve` 404s on a cross-tenant id and confirms
  the case is not silently resolved.
- `POST /exceptions` confirms a newly created case is stamped with the
  caller's real `companyId`, not the schema's `"default-company"` default
  - the regression test for the quieter of the two bugs in this slice.

Full `npm test`: 561 passing, 0 failing (7 new tests correctly skipped in
memory mode - `ReturnRequest.companyId`/`ExceptionCase.companyId` are real
Postgres columns, invisible without a database). `architecture-lint`:
`unscoped-tenant-query` baseline dropped by 5 real fixes (the three
`ReturnRequest` `findUnique`s and two `ExceptionCase` `findUnique`s); the
`GET /exceptions` and `createExceptionCase()` fixes are real but invisible
to the lint rule's regex window (it only scans a fixed number of lines
immediately after the flagged call, and both fixes set `companyId` via a
variable used several lines away, not literally inline) - both are proven
instead by this slice's own Postgres tests. `contract:validate`/
`contract:check-drift` both pass.

## What's still pending

`Transfer`/`StockCount`/`ExpiryAlert`/`Item`/`Supplier` call sites across
`routes/operations-extension.ts`, `routes/catalog-procurement.ts`,
`lib/orders.ts`, and `lib/persistence.ts` remain the standing
`unscoped-tenant-query` backlog. `Supplier`'s own missing tenant-scope
column (flagged in Week 24) is still a prerequisite for fixing `GET
/suppliers/:id/score` properly.
