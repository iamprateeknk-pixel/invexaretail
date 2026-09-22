# ADR-006: Event delivery is in-memory buffer + durable Postgres outbox, not SSE-only

## Context
`lib/event-bus.ts` publishes domain events (`stock.changed`, `transfer.changed`,
etc.) to two places: an in-process ring buffer (`buffer`, cap 1000, used when
no database is configured - memory mode) and, when a database is configured,
a durable `DomainEventOutbox` row. `routes/events.ts` serves Server-Sent
Events from whichever source is active, with a replay cursor
(`lastEventId`) and a `SERVER_EPOCH` guard so a client that reconnects after
a restart gets a `reset` event instead of silently missing events. This
session made `DomainEventOutbox` a first-class Prisma model (previously
hand-created raw SQL, see ADR-003) with a `BigInt` autoincrement id.

## Decision
Keep the dual-mode design: in-memory buffer for memory/demo mode (no
database), durable Postgres outbox for database mode. Do not require a
message broker (Kafka/RabbitMQ/Redis Streams) for this - the durable outbox
is per-replica-readable via a shared Postgres table, which is sufficient at
this app's current replica count (Render's `invexaretail-api` + one worker
per `render.yaml`), and matches the Week 7 direction ("outbox event in the
same transaction as business state... idempotent worker").

## Alternatives considered
- **SSE-only, no durable outbox.** Rejected: already identified as a defect
  class the blueprint calls out directly - "do not rely on process-local
  arrays or in-process SSE as the durable source" (Week 7). A restart or a
  second replica would silently drop events for anyone not connected to the
  exact process that raised them.
- **Move to a message broker now.** Deferred, not rejected: revisit if
  replica count or throughput outgrows a single Postgres table polled by
  `durableEventsSince`/`durableLatestEventId` (current query: index on
  `(companyId, id)`, `take: 500` per poll - fine at today's scale, a future
  bottleneck if event volume grows an order of magnitude).

## Migration impact
`DomainEventOutbox.id` changed from MySQL's `BIGINT AUTO_INCREMENT` (raw SQL)
to Prisma's `BigInt @id @default(autoincrement())` (Postgres `bigserial`) -
same behavior, now schema-managed instead of hand-created.

## Compatibility
No API/SSE protocol change. `locationIds` stays a JSON array column, filtered
in-application by `canReceive()`.

## Rollback
N/A - no code changes shipped beyond the ADR-003 schema-ownership move,
which already has its own rollback path.

## Consequences (measurable)
- The outbox table is now migration-owned (`prisma migrate deploy` creates
  it), removing one more entry from the runtime-DDL surface tracked in
  ADR-003.
- Worker/idempotent-consumer semantics for this outbox (poison-event
  handling, retry/backoff) remain a Week 7 task, not addressed here - this
  ADR only freezes today's read/write shape so that work has a stable base.
