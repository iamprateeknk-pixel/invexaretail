# SLOs, tracing and alerting (Week 19)

## Tracing

`api/src/lib/telemetry.ts` starts OpenTelemetry (HTTP + Express instrumentation, OTLP/HTTP export) **only** when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; otherwise nothing is loaded. It is imported first by `src/index.ts` and `src/worker.ts`.

| Variable | Meaning |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL, e.g. `https://otlp.example.com`. Unset = off. |
| `OTEL_SERVICE_NAME` | Defaults to `invexa-api`; set `invexa-worker` for the worker. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Vendor auth headers, injected via the platform's secret store. |
| `OTEL_SDK_DISABLED=true` | Kill switch. |

Spans never carry request bodies, tokens or user data. Failures to start are logged and swallowed - observability cannot take the API down. Error responses already carry a stable `traceId` (`lib/errors.ts`); correlating that id with exported spans is future work.

## What is measured today

`lib/request-metrics.ts` keeps in-process per-route counts, error classes and latency samples (exposed through the command-center reports). There is **no** DB-pool, queue-lag, reconciliation or mobile-sync-age metric exported yet, and no dashboard or alert routing is configured - those need a metrics backend chosen by the owner.

## Proposed SLOs (owner must approve the numbers)

| SLI | Target | Window | Source |
|---|---|---|---|
| API availability (non-5xx on `/api/v1/*`) | 99.5 % | 30 d | request metrics / platform |
| p95 latency, read routes | < 500 ms | 30 d | request metrics |
| p95 latency, stock post (`InventoryPostingService`) | < 300 ms | 30 d | needs new timer |
| Outbox lag (oldest undelivered `DomainEventOutbox` row) | < 60 s | 30 d | needs new gauge |
| Import commit throughput | 5,000 rows < 5 min | per run | `ImportBatch` timestamps |
| Stock reconciliation delta (`scripts/reconcile-stock-journal.mjs`) | 0 unexplained rows | daily | script exit code |
| Mobile sync age (oldest PENDING command) | < 15 min | continuous | needs server-side report of the queue |
| Restore time (RTO) | < 60 min | per drill | backup-restore runbook |

## Alerts to configure once a backend exists

Page: availability burn > 2 %/h, reconciliation delta > 0, outbox lag > 5 min, DB pool saturation > 90 %. Ticket: p95 breach for 1 h, POISON outbox rows > 0, import failure rate > 5 %.

## Failure drills - not yet run

Restart API/worker, replay events, degrade the database, restore a backup and rehearse migration rollback all need a staging environment. `docs/release-evidence/week-01-containment/backup-restore-runbook.md` holds the one restore rehearsal done so far (local).
