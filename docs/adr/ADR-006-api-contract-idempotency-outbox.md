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
