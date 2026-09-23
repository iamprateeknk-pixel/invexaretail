# Week 14: DomainEventOutbox retention (investigating the Week 7 gap)

## Scope note

Same situation as Weeks 12-13: the guide's Week 14 text isn't checked into
this repo. This week closes out the standing `startOutboxWorker`-never-
wired gap that Weeks 11-13 kept carrying forward, by actually investigating
it rather than deferring it again.

## What the investigation found

Week 7 built `lib/outbox-worker.ts` as a generic, well-tested delivery
worker: claim a batch, hand each row to a `DeliveryHandler`, retry with
backoff, mark POISON after `MAX_DELIVERY_ATTEMPTS`. It was never called
from a production entrypoint because nobody had decided what the
`DeliveryHandler` should actually do. This week made that decision by
tracing every path that reads `DomainEventOutbox`:

- **`routes/events.ts`'s SSE stream** (the reason this table exists at all)
  reads it directly via `durableEventsSince(cursor, ...)` on a 1-second
  poll, filtered by `id > cursor`. It does not check, and does not care
  about, the row's delivery `status` - a client just wants "everything
  since my last cursor," delivered-and-tracked or not. The worker's
  claim/DELIVERED/POISON bookkeeping is invisible to this consumer.
- **The webhook system** (`lib/webhook-dispatcher.ts`, `webhook-store.ts`,
  `webhook-retry.ts`) is a separate, already-working, already-tested
  mechanism with its own delivery/retry logic, triggered directly at
  business-write call sites (`emitWebhookEvent`) with a real entity payload
  (`WebhookEmitInput.data`). `DomainEventOutbox` rows carry no entity
  payload at all - just `topic`, `companyId`, `locationIds`, `actorId` - so
  there is nothing here a webhook delivery could actually send.
- **The audit trail** (`lib/audit.ts`'s `recordAudit`/`persistAudit`,
  `AuditLog`) is a third, richer, already-working mechanism (entity type,
  entity id, before/after values) written directly at business-write call
  sites too.

Conclusion: there is no real, uninvented consumer for
`startOutboxWorker`'s `DeliveryHandler`. Wiring one anyway - to SSE (already
handled, differently), to webhooks (wrong payload shape) or to the audit
log (already covered, better) - would be forcing a shape onto a problem
that doesn't need it, exactly the kind of "shallow stand-in" this repo's
own conventions warn against.

## The actual bug, and the fix

Tracing the writers instead of the (absent) readers found a real, live
problem: **every business mutation writes a `DomainEventOutbox` row
(`publishEvent`/`recordOutboxEventInTransaction`), and until this week
nothing ever deleted one.** With the worker correctly never wired to mark
rows DELIVERED, and nothing else pruning by age, the table grows without
bound in production, forever, at the rate of every mutation the API ever
serves.

This week fixes that directly:

- `lib/event-bus.ts`'s `pruneDomainEventOutbox(olderThanDays)`: deletes
  rows older than `OUTBOX_RETENTION_DAYS` (7, a deliberate decision -
  enough runway for a disconnected SSE client to reconnect and replay via
  `durableEventsSince`, short enough to bound growth).
- `lib/outbox-retention.ts`: `startOutboxRetention`/`pruneOutboxOnce`, a
  once-a-day poll loop (same shape as Week 11's `import-worker.ts`), wired
  into `worker.ts`'s boot sweep and background loop.
- `lib/outbox-worker.ts` itself is untouched and still not called from a
  production entrypoint - correctly, per the investigation above, not as
  an oversight.

## Testing

`api/src/lib/outbox-retention.postgres.test.ts` (real Postgres, 2/2
passing): pruning removes rows older than the retention window and leaves
recent rows alone; a client reconnecting within the window can still
replay every event through `durableEventsSince` after a prune has run.

## Not done

- `lib/outbox-worker.ts`'s retry/POISON machinery remains fully built and
  fully tested (Week 7) but genuinely unused. It is not deleted - if a real
  payload-bearing external consumer appears later, the worker is ready for
  it; this week's finding is that none exists *yet*, not that the worker
  was a mistake.
- No admin UI for `listPoisonEvents`/`requeuePoisonEvent` - moot for now
  since nothing ever poisons a row without the worker running, but worth
  revisiting alongside whatever eventually consumes the worker.
