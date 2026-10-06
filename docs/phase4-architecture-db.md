# Phase 4: architecture, API and database

Everything here was verified against a real Postgres 17 (local Docker), not
only memory mode.

## Checked first

- "Add a unique constraint on `(channel, externalReference)`" - already
  present. `Order` has `@@unique([channel, externalReference])` and it has
  been in the schema since `20260922123350_init_postgres`.
  `docs/week36-partial-incomplete-remediation.md` says the opposite; that
  statement is out of date, so no migration is needed for it.
- `prisma migrate diff --from-config-datasource --to-schema` against a
  database built only from `prisma/migrations/` reports no difference, so
  schema and migrations agree (including the two new migrations below).

## Shipped

1. **Transfer evidence extracted from `core.ts`.**
   `POST/GET /transfers/:transferId/evidence[/:evidenceId]` now live in
   `routes/transfer-evidence.ts` with the same auth chain and unchanged
   handlers. Mounted in `index.ts`, registered in
   `route-auth-coverage.test.ts`, covered by `transfer-evidence.test.ts`.
   `core.ts` shrank by about 55 lines. This is the "Transfer evidence" row of
   `docs/route-ownership-matrix.md`'s backlog.
2. **Float to Decimal, slice 2: `ExceptionCase.valueAtRisk`**
   (`20261110090000_exception_case_value_at_risk_decimal`, `NUMERIC(14,2)`).
   Chosen because it is written once and never used in arithmetic. API
   responses go through `serializeExceptionCase` so clients still receive a
   JSON number (a raw Prisma `Decimal` serialises as a string). Regression
   test: `operations-extension-returns-exceptions.postgres.test.ts`.
   `float-money` lint baseline went from 17 to 16.
3. **Phase 3 verification.** `bundles.postgres.test.ts` (4 tests) and the
   `20261109090000_item_bundle_components` migration were run on real
   Postgres; a fixture bug (ledger rows need a lot) was fixed.

## Not done

- The remaining Decimal fields (16 money, 50 quantity) - quantities feed
  stock arithmetic everywhere, so each needs its own reviewed slice.
- The other 20 or so `core.ts` Transfer routes (status lifecycle, receive,
  pick waves). `receive` is the highest-risk handler and needs a service
  extraction, not a mechanical move.
- `POST /transfers/:id/evidence` upload and storage paths still depend on the
  database; only auth and not-found behaviour are covered in memory mode.
