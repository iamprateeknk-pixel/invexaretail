# ADR-006: freeze the target API contract (versioned OpenAPI, idempotency keys, stable error envelope); the durable outbox is already real

## Context
Three related gaps, all under "the API contract isn't written down anywhere
except the code that happens to implement it today":

- **No OpenAPI spec.** `ENABLE_SWAGGER` exists as an env flag
  (`.env.example`) but nothing in the repo generates or serves a spec from
  it. 34 routers each define their own request/response shapes inline.
- **Idempotency keys exist, but ad hoc.** `requestId`-style dedupe appears in
  several places (`routes/core.ts`, `transfer-logistics.ts`,
  `catalog-procurement.ts`, `lib/transfer-receipt.ts`'s
  `findReceiptByRequestId`) with no shared header name, no shared storage
  pattern, and no guarantee every mutating endpoint that needs one has one.
- **Error envelope is inconsistent.** Most routes return `{ error: string }`;
  some add `code` (`enterprise-auth.ts`'s `DATABASE_RECONNECTING`, the new
  `REFRESH_TOKEN_REUSED`/`OTP_*` codes from ADR-003); most do not. A client
  cannot reliably branch on anything but the HTTP status and a free-text
  string.

Separately, the one piece of this ADR that **is** already real:
`lib/event-bus.ts`'s durable `DomainEventOutbox` (a first-class Prisma model
as of ADR-004's Postgres migration) plus `routes/events.ts`'s SSE replay
cursor and `SERVER_EPOCH` reset guard, so a client reconnecting after a
restart or against a different replica gets a `reset` event instead of
silently missing events.

## Decision
1. **Outbox**: keep the dual-mode design as-is - in-memory ring buffer for
   memory/demo mode, durable Postgres outbox for database mode. No message
   broker (Kafka/RabbitMQ/Redis Streams) yet; the outbox is a shared Postgres
   table readable by every replica, sufficient at this app's current replica
   count (Render's `invexaretail-api` + one worker per `render.yaml`).
2. **Error envelope** (target, not yet enforced): every error response is
   `{ error: string (human-readable), code: string (stable, SCREAMING_SNAKE_CASE) }`.
   `code` is the thing clients branch on; `error` can change wording freely.
   Retrofitting every existing route to this shape is out of scope this
   week - new routes and any route touched for other reasons adopt it now.
3. **Idempotency keys** (target, not yet enforced): a mutating endpoint that
   can be safely retried accepts a client-supplied `requestId` (body field,
   matching the existing convention rather than inventing an
   `Idempotency-Key` header) and returns the original result on replay
   without double-posting - the pattern `lib/transfer-receipt.ts` already
   implements is the reference implementation for new endpoints to copy.
4. **OpenAPI**: deferred to a dedicated week (not this one - "no large
   refactor yet"), generated from the routers rather than hand-maintained
   separately from them, once the bounded-context split from ADR-005 makes
   "one spec file per context" tractable.

## Alternatives considered
- **SSE-only, no durable outbox.** Rejected: identified directly as a defect
  class - "do not rely on process-local arrays or in-process SSE as the
  durable source" (Week 7 of the execution guide). A restart or a second
  replica would silently drop events for anyone not connected to the exact
  process that raised them.
- **Move to a message broker now.** Deferred, not rejected: revisit if
  replica count or throughput outgrows a single Postgres table polled by
  `durableEventsSince`/`durableLatestEventId` (current query: index on
  `(companyId, id)`, `take: 500` per poll - fine at today's scale).
- **Hand-write an OpenAPI spec today.** Rejected: with two mega-files still
  unsplit (ADR-005), a hand-written spec would drift from the code within a
  week. Ordering this after the bounded-context split avoids writing the
  same migration twice.
- **`Idempotency-Key` header (Stripe-style) instead of a `requestId` body
  field.** Rejected: the codebase already has a working, tested convention;
  introducing a second idempotency mechanism alongside it is the kind of
  parallel-system risk ADR-001 exists to call out for stock tables.

## Migration impact
`DomainEventOutbox.id` changed from MySQL's `BIGINT AUTO_INCREMENT` (raw SQL,
see ADR-004) to Prisma's `BigInt @id @default(autoincrement())` (Postgres
`bigserial`) - same behavior, now schema-managed instead of hand-created.
Nothing else in this ADR changes code this week; the error-envelope and
idempotency-key items are conventions for new/touched code, not a retrofit.

## Compatibility
No API/SSE protocol change from the outbox work. `locationIds` stays a JSON
array column, filtered in-application by `canReceive()`.

## Rollback
N/A - no code changes ship with the contract-convention parts of this ADR;
the outbox model change rolls back with ADR-004.

## Consequences (measurable)
- The outbox table is migration-owned (`prisma migrate deploy` creates it),
  removing one more entry from the runtime-DDL surface tracked in ADR-004.
- Worker/idempotent-consumer semantics for this outbox (poison-event
  handling, retry/backoff) remain a Week 7 task, not addressed here - this
  ADR only freezes today's read/write shape so that work has a stable base.
- Error-envelope and idempotency-key adoption is tracked qualitatively for
  now (no lint rule yet - `{error, code}` is hard to check safely by regex
  without false positives across 34 routers); a future week can add a
  route-response-shape test once enough routes have adopted it to set a
  meaningful baseline.

## Addendum (Week 7): the outbox worker, and the stable error envelope shipped

The gap named above - "Worker/idempotent-consumer semantics for this outbox
... remain a Week 7 task" - is closed this week:

- **`lib/outbox-worker.ts`**: `drainOutboxOnce(handler, batchSize)` claims a
  batch of `PENDING` rows with `SELECT ... FOR UPDATE SKIP LOCKED` (safe for
  more than one worker process to poll concurrently), hands each to a
  delivery handler, and durably records the outcome on the row itself -
  `status` (`PENDING`/`DELIVERED`/`POISON`), `attempts`, `availableAt`
  (retry/backoff gate) and `lastError`. This *is* the durable cursor: no
  separate offset table, because the row's own status is authoritative and
  cannot drift from what was actually delivered the way a separate cursor
  table could.
- **Crash safety**: a claimed row's `availableAt` is pushed forward (a
  30-second lease) but its `status` stays `PENDING` until the handler
  succeeds. A worker that crashes mid-delivery leaves the row `PENDING`; once
  the lease expires, the next drain reclaims it. An event can therefore be
  redelivered at least once after a crash, never lost - callers are expected
  to tolerate that the same idempotency-key discipline used everywhere else
  in this codebase already requires.
- **Poison events**: after `MAX_DELIVERY_ATTEMPTS` (5) failed attempts with
  exponential backoff (2s/4s/8s/16s/32s), a row moves to `status = 'POISON'`
  with `lastError` populated - a visible, queryable exception
  (`listPoisonEvents()`), never a silently dropped event. `requeuePoisonEvent`
  is the operator recovery path.
- **Reservation writes its outbox row transactionally now**: the
  `recordOutboxEventInTransaction` helper in `event-bus.ts` lets a caller
  pass the same `tx` it used for its business write, so the outbox row
  commits or rolls back with the business state instead of the old
  publish-then-persist-separately sequence that could lose an event in the
  gap between them. Only the reservation primitive (this week's other
  deliverable) has been switched to it; the many existing `publishEvent()`
  call sites elsewhere in the codebase keep their existing post-commit,
  fire-and-forget persist - migrating those is future work, not silently
  broken by this addition (both paths write to the same table; a handler
  never needs to know which path an event arrived through).
- **Stable error envelope, now enforced for the new code**: `lib/errors.ts`'s
  `DomainError` (`{ error, code, traceId }`) is thrown by the reservation
  primitive and the new `lib/domain-policies.ts` transition guards, and
  `src/index.ts`'s last-resort error handler now recognizes it and returns
  the envelope with the matching HTTP status instead of collapsing it into a
  generic 500. This is adoption for the new Week 7 code, not the full
  retrofit this ADR already scoped as future work in its original text
  above.

## Addendum (Week 8): the first versioned OpenAPI contract, and the `api/dist` decision

The "OpenAPI: deferred to a dedicated week" line above is partially closed:
`contracts/openapi.json` (OpenAPI 3.1, `info.version: "2026.8.0"`) now
documents the endpoints extracted this week (`GET /transfers/list`,
`POST /transfers`, and the four `/branches` routes), including the
`ErrorEnvelope` schema (`{error, code, traceId}`) as a first-class component
and the reservation path's `422 INSUFFICIENT_STOCK` response using it. This
is deliberately **not** a spec for the whole API - the ~180 routes still on
`core.ts`/`operations-extension.ts` are not documented here, so the contract
can never silently drift ahead of what has actually been modularized (see
`docs/route-ownership-matrix.md`). Extending the contract is part of
extracting each future module, not a separate catch-up task.

**Generated clients**: `contracts/generated/types.ts` (via
`openapi-typescript`, `npm run contract:generate`) and
`contracts/generated/client.ts` (a minimal typed fetch wrapper, not a full
codegen SDK - proportionate to a five-endpoint contract). Both compile
standalone (`npm run contract:typecheck`, its own `contracts/tsconfig.json`)
and CI checks them for drift against the spec (`npm run contract:check-drift`)
so an edited spec without a regenerated, committed client fails the build.
`npm run contract:validate` structurally validates the spec itself (valid
JSON, every `$ref` resolves, every operation has an `operationId` and a
response, the error envelope schema is present) - no new runtime dependency
for a document this size.

**`api/dist` removal - deferred, not done, with a concrete reason.** The
guide's gate is "prove deploy builds from source, only then remove committed
`dist`." Render's own deploy (`render.yaml`'s `buildCommand: cd api && npm
install && npm run build`) already builds from source - proven again this
week with a clean `rm -rf dist && npm run build`. But a second deploy path
exists: `api/app.js` (the "Hostinger startup file" CI already smoke-tests)
`require.resolve('./dist/index.js')`s directly, with no build step of its
own - it is written to run against a checkout that already has `dist/`
present. Deleting committed `dist` would silently break that path the next
time it deploys, with no CI signal, because CI's own "Verify Hostinger
startup file" step runs `node app.js` *after* the build step in the same
job has already regenerated `dist/` - it does not prove the committed
artifact is unnecessary, only that this job's freshly-built one works.
Removing committed `dist` safely needs one of: teaching the Hostinger
deploy process to run `npm run build` first, or changing `app.js` to build
on demand if `dist/` is missing. Neither is a one-line change to make
alongside an unrelated god-router extraction, so this is recorded as an
approved exception (per this week's Definition of Done: "Independent review
comments are resolved or recorded as an approved exception") rather than
silently skipped or forced through.
