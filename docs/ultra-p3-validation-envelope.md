# [ULTRA] P3 — Validation + error envelope (issue #186)

## Census (measured 2026-11-09 on main `f9168f1b`, before this PR)

- 46 non-test route files in `api/src/routes/`; **251 mutating route
  definitions** (180 `.post(`, 27 `.patch(`, 22 `.delete(`, 22 `.put(`).
  (Re-measured 2026-11-09 with `grep -o` per file — the earlier 254
  figure double-counted 3 `.delete(` sites.)
- Error-shape sites in `api/src` before: 774 `.json({ message`,
  145 `.json({ error`, 117 `.json({ success`; 747 of the `{ message }`
  sites were 4xx/5xx error responses.
- Mutating definitions per file (each definition is one line, so
  definition counts = line counts): control-plane 52,
  catalog-procurement 21, enterprise-auth 20, core-imports 18,
  enterprise-management 11, opext-jobs 10, core-counts 10, transfers 9,
  core-identity 9, opext-orders 8, campaigns 8, opext-rules 7,
  opext-returns 7, opext-qc-exceptions 6, opext-bins 5, core-picking 5,
  core-catalog 5, transfer-logistics 4, opext-webhooks 4, imports 4,
  opext-platform 3, opext-expiry 3, branches 3, reports 2,
  opext-serials 2, opext-collab 2, items 2, item-master 2, bundles 2,
  transfer-evidence 1, opext-intelligence 1, marketplace-webhook 1,
  location-order 1, evidence-access 1, events 1, command-center 1;
  0 in transfer-labels, route-table.golden, opext-shared,
  operations-extension, import-control-center, entities,
  enterprise-analytics, core, core-shared, core-insights.

## Envelope chosen

The repo's closest existing convention, ADR-006's flat shape
(`lib/errors.ts`, already used by the reservation/transition/outbox
paths):

```json
{ "error": "<message string>", "code": "<STABLE_CODE>", "traceId": "<uuid>" }
```

plus optional `details` (`[{ path, message }]` — zod issues on a 400)
and optional top-level extras preserved from the old responses
(`approvalRequestId`, `requiredApproverRole`, `shortages`,
`verification`, `guardrail`, `missingIds`, `lineId`/`itemId`,
`errors`). The nested `{ error: { code, message, details } }`
alternative was rejected: migrating the existing ADR-006 adopters
would have been a bigger breaking change. `sendError(res, status,
code, message, extra?)` builds it; `traceId` is
`res.locals.requestId` when set, else a fresh UUID. The last-resort
500 handler in `src/index.ts` now emits `traceId` too (was
`requestId`); the Multer upload-boundary handler is untouched
(upload-boundary tests assert its `{ message }` shape — out of scope).
`web/src/lib/api-client.js` already reads
`errorBody.message ?? errorBody.error ?? ...`, so the web UI keeps
working. Success shapes (`{ success, ... }`, 200/201 bodies) are
untouched.

## Validation layer

- `api/src/lib/validate.ts` — `validate(schema)` middleware +
  `parseBody(req, res, schema)` helper. A schema failure sends the
  400 envelope `{ error: 'Validation failed.', code:
  'VALIDATION_FAILED', traceId, details: [{ path, message }] }`.
  On success the parsed data is **merged** into `req.body`, never
  replaced. Schemas are deliberately not `.strict()`: extra fields
  pass through as before.
- `api/src/lib/validation-schemas.ts` — one zod schema per converted
  mutating route (see below). Parity rules: no role/tenant/existence/
  state-machine checks (those stay in the handler/service); coercion
  mirrors each handler (`z.number()` where the handler checked
  `Number.isFinite` on the raw value, `z.coerce.number()` where it
  used `Number(...)`); where a handler *filters* junk lines instead
  of rejecting (POST /orders, POST /purchase-orders/:id/invoices),
  the schema applies the identical filter as a transform.
- `parseBody` placement: inside the handler, after the entity/tenant/
  role guards, at the exact point the hand-rolled check ran — so
  404-before-400 and 403-before-400 precedence is preserved.
  Exception: POST /transfers uses the `validate()` middleware (role
  checks live inside the `createTransfer` service).
- `api/src/lib/errors.ts` — `ERROR_CODES` gains `FORBIDDEN`,
  `CONFLICT`, `INTERNAL_ERROR`, `NOT_SUPPORTED`, `UPSTREAM_ERROR`,
  `QC_REQUIRED`, `SELF_REVIEW`, `RECOUNT_REQUIRED`,
  `RECOUNT_NOT_INDEPENDENT`; `ErrorEnvelope` gains optional
  `details`; new `errorEnvelope()` / `sendError()` helpers.
  `VALIDATION_FAILED` stays 422 in `statusForErrorCode` (the
  DomainError path is untouched); schema failures send 400 directly
  per #186's acceptance ("invalid payloads return the single envelope
  with 400").

## Scope of this PR — 55 of 251 mutating definitions

| File | Converted routes |
| --- | --- |
| `routes/transfers.ts` (9) | POST /transfers (schema), PATCH /transfers/:id (schema), DELETE /transfers/:id, PATCH /transfers/:id/status (schema), GET /transfers/:id/eligible-pickers, GET /picker/transfers/:id, PATCH /transfers/:id/picker (schema), POST /picker/transfers/:id/allocation-preview (schema), POST /picker/transfers/:id/pick-slips (schema), POST /transfers/:id/confirm, GET /transfers/:id/export.xls, POST /transfers/:id/receive (schema) |
| `routes/opext-returns.ts` (7) | POST /orders/:id/returns (schema), GET /orders/:id/returns, PATCH /returns/:id/status, POST /returns/:id/lines/:lineId/disposition (schema), PATCH /returns/:id/refund (schema), POST /orders/expire-reservations, POST /orders/retry-backorders, POST /orders/:id/retry-backorder |
| `routes/opext-orders.ts` (8) | POST /orders (schema), POST /orders/:id/fulfill, POST /orders/:id/cancel, POST /orders/:id/pack/start, GET /orders/:id/pack, POST /orders/:id/pack/scan (schema), POST /orders/:id/pack/seal, POST /orders/:id/ship, GET /orders/:id/shipment, POST /shipments/:awb/cancel |
| `routes/core-counts.ts` (10) | POST /stock-counts (schema), POST /stock-counts/weight (schema), PATCH /stock-counts/:countId/review (schema), POST /stock-counts/:countId/reconciliation/ack (schema), POST /count-assignments (schema), PATCH /count-assignments/:assignmentId (schema), DELETE /count-assignments/bulk (schema), DELETE /count-assignments/:assignmentId, POST /cycle-counts/:locationId/assign (schema), plus GET /count-assignments, GET /count-assignments/mine, GET /cycle-counts/:locationId |
| `routes/catalog-procurement.ts` (21) | Full-file conversion: tags, custom fields + values, reorder rules + suggestions, suppliers, price breaks, supplier score, purchase orders (create/receive/status/plan/plan-draft/invoices), prices + price resolution, saved reports, saved views |
| `routes/opext-shared.ts` | Shared role guards `requireAdmin` / `requirePacker` / `requirePlatformOperator` now send the envelope (also benefits the other opext routers that call them; their other errors are untouched) |
| `src/index.ts` | Last-resort 500 handler: `requestId` → `traceId` |

After this PR the repo-wide literal counts are 504 `.json({
message` (was 774) and 479 4xx/5xx `.json({ message` (was 747);
the touched files have **zero** raw error responses left (verified
by grep and by the lint rule below). The literal `.json({ error`
count (145) does not move — `sendError` builds the envelope
internally, so it is not a literal `.json({ error` site.

### No-schema, envelope-only routes (deliberate)

- Transfers confirm/delete; returns status action (transition
  logic); orders fulfil/cancel/pack-start/pack-seal/ship/
  shipment-cancel/expire-reservations/retry-backorders.
- Suppliers create/update (`parseSupplierFields` stays the authority
  — email regex, text lengths, leadTime 0–365, moq, categories,
  status enum), custom-field-value PUT, tags PUT (`tagIds`
  non-array means "clear all tags").

### Behaviour notes (all intentional, all documented)

- **500 → 400 normalizations** (invalid input used to crash or
  reach Prisma as an Invalid Date): invalid `countDate`, invalid
  `expectedAt`, invalid `invoiceDate`, garbage `unitCost` on a
  purchase-order line.
- **Same-source transfer is now 400, not 403**: the zod schema
  rejects it before `createTransfer`'s generic catch turned the
  validation error into a 403. Same for the store-user warehouse
  rule (400, unchanged status — only the envelope changed).
- **POST /transfers middleware corner**: role + bad body now
  returns 400 (schema first) instead of 403; a store user posting
  same-source now gets the same-source message instead of the
  warehouse message. Same 400 status either way.
- **Weight-count presence check stays ahead of the location check**,
  exactly as before (a missing itemId/locationId is a 400 even for
  a location the caller cannot access).
- **Count-review parsers still run** after the schema (they produce
  the stored values and cannot throw on schema-valid input).
- **Returns-create keeps its legacy `errors` array** (top-level
  extra, not duplicated into `details`).

## Lint rule

`scripts/architecture-lint.mjs` gains `raw-error-envelope`, scoped
to the six converted files (transfers, opext-returns, opext-orders,
core-counts, catalog-procurement, opext-shared). It flags any
`res.status(4xx|5xx).json({ message…` in those files and fails CI
(`npm run lint:arch`, run in CI). Baseline for the rule is empty:
0 existing, 0 new after this PR. The rule is scoped, not repo-wide,
because the other ~40 route files still return raw shapes — that is
the follow-up remainder below, not baseline.

Note: `npm run lint:arch` (`--check`) already fails on main
`f9168f1b` with 5 pre-existing violations in files this PR does not
touch (`direct-stock-write` in
`src/lib/repositories/stock-parity-harness.ts:74`,
`unscoped-tenant-query` in
`src/lib/repositories/transfer-repository.ts:71,99`,
`float-money` in `prisma/schema.prisma:2268,2382`) — verified
identical on a pristine worktree of main. This PR adds none and
does not re-baseline them; that is a separate decision.

## Tests

- `api/src/lib/validation-schemas.test.ts` — 12 tests (was 11):
  valid/invalid/boundary payloads per schema, including the parity
  fixes (empty `countDate` counts as absent; a non-string
  `assignedToId` is dropped; bulk-delete drops junk ids).
- `api/src/routes/validation-envelope.http.test.ts` (new, memory
  mode) — 8 tests, one per reachable converted route, asserting the
  exact envelope (`error` + `code` + `traceId`, no `message`).
- `api/src/routes/validation-envelope.postgres.test.ts` (new,
  `TEST_DATABASE_URL`-gated) — 7 tests covering the DB-backed
  routes (returns, pack/ship, procurement families).
- Updated existing tests that asserted the old `{ message }` body:
  `routes/transfers.test.ts` (same-source 403→400, store-user body
  now loc-1→loc-2 so it tests the warehouse rule),
  `routes/item-master.http.test.ts`,
  `routes/picking.http.test.ts`,
  `routes/mobile-work.http.test.ts`,
  `routes/transfer-picker-assignment.http.test.ts`,
  `routes/audit-improvements.postgres.test.ts` (reorder-rule
  fraction message).
- `npx tsc --noEmit` clean; full `npm test` (memory mode) 2026-11-09:
  1293 tests, 968 pass, **1 fail**, 324 skipped. The single failure
  is the pre-existing `contract-coverage` test
  ("every documented operation … is reachable"), which fails
  identically on a pristine worktree of main `f9168f1b` — not caused
  by this PR. The 324 skips are the `TEST_DATABASE_URL`-gated
  postgres suites (no database in this VM); CI must cover them.
  `node scripts/architecture-lint.mjs --check` adds no new
  violations from this PR (the 5 above are pre-existing on main).

## Verification limits (honest)

- Local `npm install` could not download the Prisma engine binary
  (network reset); `node_modules` was copied from the earlier
  verified `ci-local` tree (identical `package.json` dependency
  lists, zod 4.6.5, generated `.prisma/client` from the pre-P2
  schema). Memory-mode tests are unaffected (P3 touches no Prisma
  models); CI must cover `prisma generate` and the postgres suites.
- The postgres envelope tests are skipped locally (no
  `TEST_DATABASE_URL` here) and are proven only by CI.

## Remainder on #186 (do NOT close the issue)

196 of 251 mutating definitions remain, in these files: control-plane 52, enterprise-auth 20, core-imports 18,
enterprise-management 11, opext-jobs 10, core-identity 9, campaigns
8, opext-rules 7, opext-qc-exceptions 6, opext-bins 5, core-picking
5, core-catalog 5, transfer-logistics 4, opext-webhooks 4,
imports 4, opext-platform 3, opext-expiry 3, branches 3, reports 2,
opext-serials 2, opext-collab 2, items 2, item-master 2, bundles 2,
transfer-evidence 1, opext-intelligence 1, marketplace-webhook 1,
location-order 1, evidence-access 1, events 1, command-center 1.
Follow-up work: one `validate()` + schema pass per family in the
same pattern as this PR, extending the `raw-error-envelope` lint
scope file by file as each lands. The Multer upload-boundary
handler (`src/index.ts`) and the `GET`-only success shapes are
separate decisions, not part of the remainder count.
