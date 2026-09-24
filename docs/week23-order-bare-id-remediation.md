# Bare-id call-site migration: Order routes in operations-extension.ts

## Scope

The tenant-scope migration (Weeks 17/19, Transfer/StockCount/ExpiryAlert
follow-ups) gave all five originally-`tenantId`-only models a real
`companyId` column. What it deliberately left for later is the much larger
job: the ~90 call sites across `routes/operations-extension.ts` and
`routes/core.ts` that look a row up by bare id with no tenant filter at
all - tracked in `architecture-lint.mjs`'s `unscoped-tenant-query`
baseline since Week 15.

This is a first bounded slice of that remediation: every `Order`-model
call site in `routes/operations-extension.ts`, chosen because `Order`
already has a real `companyId` (Week 19) and this file's order/pack/ship/
returns routes form one coherent, self-contained group.

## The real vulnerability, not just a lint nag

Every fixed route followed the same pattern:

```ts
const order = await prisma.order.findUnique({ where: { id: req.params.id } });
if (!order) return res.status(404).json({ message: 'Order not found.' });
if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403)...;
```

`canAccessLocation` (`operations-extension.ts:88`) returns `true`
unconditionally for `ADMIN`/`ADMIN_USER`/`AUDITOR` roles, with **no
company check anywhere in that function**. So an admin of Company A,
given (or guessing) an order id belonging to Company B, could reach the
403 check, pass it, and see or act on Company B's order - `/orders/:id/pack`,
`/pack/scan`, `/pack/seal`, `/ship`, `/shipment`, `/returns` (both GET and
POST), and `/shipments/:awb/cancel`. This is exactly the class of gap the
`unscoped-tenant-query` rule was built to surface, not a false positive.

The order-listing endpoint (`GET /orders`) had the same gap in a different
shape: its `scope` object filtered by `fulfillmentLocationId` for
non-admin roles but had **no company filter at all**, so an
`ADMIN`/`ADMIN_USER`/`AUDITOR` calling it saw every company's orders.

## What changed

Nine call sites in `routes/operations-extension.ts`:

- `GET /orders` - added `companyId: req.companyId ?? DEFAULT_COMPANY_ID`
  to the list query's `where`.
- `POST /orders/:id/pack/start`, `GET /orders/:id/pack`,
  `POST /orders/:id/pack/scan`, `POST /orders/:id/pack/seal`,
  `POST /orders/:id/ship`, `GET /orders/:id/shipment`,
  `POST /orders/:id/returns`, `GET /orders/:id/returns` - each order
  lookup changed from `prisma.order.findUnique({ where: { id } })` to
  `prisma.order.findFirst({ where: { id, companyId: req.companyId ??
  DEFAULT_COMPANY_ID } })`. A cross-tenant id now resolves to `null` -
  the existing `if (!order) return 404` path handles it, so the route's
  behavior for a genuinely missing order and a cross-tenant order are now
  identical (never revealing that the id exists at all).
- `POST /shipments/:awb/cancel` - the same fix, plus its own `Shipment`
  lookup (`Shipment` already had a real `companyId` column) changed from
  `findUnique({ where: { awbNumber } })` to `findFirst({ where: { awbNumber,
  companyId } })`.

## What's deliberately unchanged

`packVerificationFor` (an internal helper, not a route) re-fetches an
order by `order.id` - but every call site passes an `order.id` that was
already resolved through one of the now-fixed, company-scoped lookups
above, so its own re-fetch is safe by construction without needing its
own companyId parameter threaded in. Adding one anyway would be
defense-in-depth with no caller that could currently violate it - left as
a possible future hardening, not done here to keep this slice's diff
focused on real, reachable gaps.

## Testing

Full `npm test`: 561 passing, 0 failing - no regression in any existing
test that exercises these routes in memory mode. `architecture-lint`:
`unscoped-tenant-query`'s baseline dropped from 121 to 112 (9 fixed, 0
new). `contract:validate`/`contract:check-drift` both pass.

**Follow-up (closed): the cross-tenant denial itself is now proven.**
`src/routes/operations-extension-orders.postgres.test.ts` (real Postgres,
5/5 passing) is the HTTP-level harness this doc originally flagged as
missing: `withServer`/`makeFixture` mount `operationsExtensionRouter`
directly (it applies its own `extractToken`/`requireAuth` internally, so
no external auth middleware is needed), seed two real companies each with
a Postgres `User` row (for the `Order.createdById` FK) and an in-memory
enhanced-user record (what `requireAuth` actually checks), and issue a
real JWT per company via `generateJWT`. Five tests prove: a company B
token gets 404 on `GET /orders/:id/pack`, `/shipment`, and `/returns` for
a company A order (not 403 - it never reveals the order exists); the
owning company can still read its own order normally; `GET /orders`'
list only ever returns the caller's own company's orders; and
`POST /shipments/:awb/cancel` 404s on a shipment belonging to another
company. This harness is meant to be reused, not rewritten, for the next
slice of this remediation - see "What's still pending" below.

## What's still pending

Everything else in the ~90-entry `unscoped-tenant-query` baseline:
`PurchaseOrder`/`Transfer`/`ExceptionCase`/`ReturnRequest`/`StockCount`/
`ExpiryAlert`/`Item` call sites across `routes/operations-extension.ts`,
`routes/catalog-procurement.ts`, `lib/orders.ts`, `lib/persistence.ts`,
and the import-lifecycle internals (`lib/import-commit-service.ts` etc. -
many of these are already scoped one level up by their caller and are
lower priority than the direct `req.params.id` route handlers). The
`bare-status-write` baseline (6 entries) is untouched by this slice.
