# Phase 8: working through the backlog

The "not done" lists from Phases 3 to 7, tackled in one pass. What was done is
verified (real Postgres where a database is involved); what was not attempted is
listed with the reason.

## Done

1. **Selling a bundle consumes its components** (`lib/bundle-expansion.ts`,
   hooked into `createOrderInner`). A kit line becomes component lines
   (quantity x component quantity, merged with any component sold on its own,
   stricter shelf-life requirement wins) before allocation, so reservation,
   fulfilment and the stock journal are unchanged and every movement is posted
   through the canonical service. The kit never holds stock. Real-Postgres
   tests (`orders-bundle.postgres.test.ts`, 5): reserve then fulfil takes the
   components off; a short component refuses the whole kit and reserves
   nothing; a foreign company's kit id is an unknown item.
2. **A real tenant leak fixed while extracting more of `core.ts`.**
   `GET /transfers/reprint-audit/all` returned every company's print log, and
   `GET /transfers/:id/reprint-audit` confirmed another company's transfer by id.
   The label and reprint-audit routes moved to `routes/transfer-labels.ts` and
   are now company-scoped (404, never 403). Tests fail if the scoping is removed
   (checked by mutation).
3. **Decimal slice 3: `ExpiryAlert.value`** (`20261113090000_*`). Nothing writes
   or reads it, so it cannot change behaviour. `float-money` baseline 16 to 15.
4. **Mobile can start a transfer.** After scanning an item, "Transfer" opens a
   screen (destination, lot with stock, quantity) that posts to
   `POST /transfers`. Validation mirrors the API's role rule and stops
   same-location, zero and over-stock requests before any network call. Needs a
   connection (the server reserves stock), so it is not queued offline.
5. **Labels in Hindi and other scripts.** Names the built-in PDF font cannot draw
   fetch Noto Sans (Latin + Devanagari) once at print time; offline it falls back
   to the default font.
6. **2FA setup shows a QR code** (generated in the browser, loaded on demand),
   and **Account security** is in the account menu for every role, not just the
   Admin page.

## Not attempted, and why

- **Database-first reads (removing the in-memory snapshot).** The API serves
  operations from a copy of the inventory held in RAM; most routes read it
  synchronously. Replacing that is a re-architecture touching hundreds of
  call sites, not something to rush in a batch. Phase 6 made hydration safe at
  scale; memory still grows with data.
- **Passkeys / WebAuthn.** Needs a relying-party library on the server and a
  browser/device ceremony that cannot be exercised in this environment.
- **The rest of the `core.ts` Transfer routes** (status lifecycle, `receive`,
  pick waves). They share local helpers and `receive` is the largest handler;
  each needs a service extraction with its own parity tests.
- **The other Decimal fields.** Remaining money fields feed arithmetic
  (thresholds, landed cost) or reach clients through the in-memory repository
  (`Item.mrp`), where a raw `Decimal` would serialise as a string. Each needs
  its own reviewed slice.
- **Offline-conflict "yours vs server" compare.** The server returns only an
  error message at conflict time; the phone has no server snapshot to compare.
- **Load test against staging.** There is no staging environment here.
