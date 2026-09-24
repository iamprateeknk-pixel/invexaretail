# Bare-id call-site migration, slice 2: PurchaseOrder routes in catalog-procurement.ts

## Scope

Continues the remediation slice 1 (Week 23, `Order` routes in
`routes/operations-extension.ts`) started. This slice: every
`PurchaseOrder`-model call site in `routes/catalog-procurement.ts`.

## The real vulnerabilities, not just a lint nag

- **`GET /purchase-orders`** took `_req` (an unused parameter - a visible
  sign nobody was reading the caller's identity at all) and returned
  `prisma.purchaseOrder.findMany({...})` with **no filter whatsoever**.
  Any authenticated user of any role, from any company, saw every
  company's purchase orders. This was the worst of this slice's findings
  - not a bare-id lookup needing a companyId added, but a list endpoint
  with zero tenant awareness.
- **`PATCH /purchase-orders/:id/status`**, **`POST
  /purchase-orders/:id/receive`**, **`POST
  /purchase-orders/:id/invoices`** each did
  `prisma.purchaseOrder.findUnique({ where: { id: req.params.id } })` with
  no company check, then acted on (or mutated) whatever it found. An admin
  of one company given or guessing another company's purchase-order id
  could approve/reject/receive it or attach an invoice to it.
- **`GET /purchase-orders/:id/invoices`** queried `SupplierInvoice` by
  `purchaseOrderId` alone, with no tenant check at all - `SupplierInvoice`
  itself has no `companyId` column, so this needed a join through the
  `purchaseOrder` relation rather than a bare column filter.

## What changed

- `GET /purchase-orders`: `_req` renamed to `req`, `where: { companyId:
  req.companyId ?? DEFAULT_COMPANY_ID }` added to the list query.
- `POST /purchase-orders/:id/receive`, `PATCH
  /purchase-orders/:id/status`, `POST /purchase-orders/:id/invoices`: each
  `prisma.purchaseOrder.findUnique({ where: { id } })` changed to
  `findFirst({ where: { id, companyId: req.companyId ?? DEFAULT_COMPANY_ID
  } })`. A cross-tenant id now resolves to `null`, hitting the existing
  `if (!order) return 404` path.
- `GET /purchase-orders/:id/invoices`: added `purchaseOrder: { companyId:
  req.companyId ?? DEFAULT_COMPANY_ID }` to the `SupplierInvoice` query's
  `where`, scoping through the relation since the table itself has no
  `companyId` column of its own.

## What's deliberately unchanged

- `prisma.purchaseOrder.update` (the status-change itself, in `PATCH
  /purchase-orders/:id/status`) uses `order.id` already resolved through
  the now-fixed lookup above - safe by construction, same reasoning as
  Week 23's `packVerificationFor`.
- `GET /suppliers/:id/score`'s `prisma.purchaseOrder.findMany({ where:
  { supplierId: supplier.id, ... } })` is scoped by a `Supplier` that was
  itself looked up by bare id with no tenant check - but `Supplier` has no
  `companyId` column at all (only the constant `tenantId`), so fixing this
  properly means a `Supplier` tenant-scope migration first, out of scope
  for a "PurchaseOrder routes" slice. Flagged here, not silently patched
  around.

## Testing

`src/routes/catalog-procurement-purchase-orders.postgres.test.ts` (real
Postgres, 4/4 passing), reusing the `withServer`/`makeFixture` harness
pattern from Week 23's `operations-extension-orders.postgres.test.ts`
rather than writing a new one:

- `GET /purchase-orders` only returns the caller's own company's orders.
- `PATCH /purchase-orders/:id/status` 404s on a cross-tenant id and
  confirms the order's status is genuinely unchanged afterward (not just
  that the response looked right).
- `GET /purchase-orders/:id/invoices` returns an empty list (not an
  error, not someone else's data) for a cross-tenant purchase-order id,
  and the real invoice for the owning company.
- `POST /purchase-orders/:id/receive` 404s on a cross-tenant id.

Full `npm test`: 561 passing, 0 failing. `architecture-lint`:
`unscoped-tenant-query` baseline dropped from 112 to 108 (4 fixed - the
`SupplierInvoice` fix scopes through a relation rather than a bare
`purchaseOrder.*` call, so it isn't counted by this rule, though it closes
a real gap). `contract:validate`/`contract:check-drift` both pass.

## What's still pending

`ExceptionCase`/`ReturnRequest`/`StockCount`/`ExpiryAlert`/`Item`/`Transfer`
call sites across `routes/operations-extension.ts`,
`routes/catalog-procurement.ts` (its `Item` and `Transfer` findMany calls
remain), `lib/orders.ts`, and `lib/persistence.ts`. `Supplier`'s own
missing tenant-scope column (noted above) is a new, separate finding worth
its own future slice.
