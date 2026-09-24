# Release scorecard (Week 20 gate) - state as of 2026-09-25

**Recommendation: NO-GO.** Only the human owner can approve production; this page records why the gates are not yet green.

| Dimension | Pass condition (guide) | State | Blocking evidence still needed |
|---|---|---|---|
| Data integrity | Zero unexplained stock delta; all mutation paths canonical | **Not met** | Transfer receipt, PO receipt, count approval and order paths still write stock outside `InventoryPostingService` (`docs/inventory-posting-coverage.md`); Float->Decimal not executed |
| Security | No P0/P1 auth/tenant issue; replay/isolation suites pass | Partial | Replay/isolation suites exist and pass; a cross-tenant marketplace-ingest hole was found and fixed in this pass, which shows tenant review is not finished (`unscoped-tenant-query` baseline still tracked). Dependency-audit exceptions need owner acceptance (`docs/security-gates.md`) |
| Reliability | Backup/restore, migration rollback, worker replay pass | Partial | Local restore rehearsal only; no staging restore, rollback or replay drill |
| Performance | p95 budgets pass at target volume | **Not measured** | No load test; budgets are proposals (`docs/slo-and-alerting.md`) |
| UX | Five golden journeys pass desktop/tablet/mobile + keyboard | Partial | Item-search journey has Playwright coverage; the other four journeys have none |
| Mobile | Signed build, secure storage, real offline DB, sync recovery | Partial | Real SQLite + secure storage in code and tested; **no signed build (no keystore secret), no device matrix, queue not yet drained to the server** |
| Observability | Trace, logs, SLO alerts, business reconciliation visible | Partial | OpenTelemetry tracing is opt-in code; no collector, dashboard or alert routing |
| Documentation | README, ADRs, API, deploy, rollback, incident docs current | Partial | README/security/SLO/offline docs rewritten this pass; no incident runbook, `AGENTS.md` week narratives predate the real guide (`docs/guide-status.md`) |
| Governance | Protected main, review gates, evidence, release owner | Unverified | Branch protection, required reviewers, signed tag and SBOM cannot be checked from the repository |
| Operations | Canary and rollback exercised; 30-day review scheduled | **Not done** | Needs a staging/canary environment |

## Five golden journeys (guide) - automation state

| # | Journey | Automated evidence today |
|---|---|---|
| 1 | PO receipt -> lot -> accepted stock -> audit/report agreement | Unit/HTTP coverage of PO receive; no end-to-end reconciliation run |
| 2 | Transfer with short/damaged receipt -> QC -> source/in-transit/destination reconciliation | Transfer HTTP tests; reconciliation not asserted |
| 3 | Blind count offline -> conflict -> recount -> approve -> post once | Assignment + contract logic tested; no mobile/server E2E |
| 4 | Marketplace order replayed twice -> one order, one reservation, reconciled return/refund | Replay -> one order and cross-tenant rejection tested (memory mode); return/refund leg not covered |
| 5 | Overlapping IDs across two tenants -> zero cross-tenant access | Item repository (5,200 items) and seven route-slice Postgres suites |

## Exceptions register

None approved. The two dependency-audit exceptions in `docs/security-gates.md` are *proposed* and need an owner and an expiry sign-off.

## Owner sign-off (to be completed by the human owner)

All P0/P1 closed or rejected: **No** · Invariants proven: **No** · Five journeys pass on the release candidate: **No** · Backup/rollback/canary rehearsed: **No** · Mobile scope: **undecided** · Hosting path approved: **undecided** · Go decision: **No-go**.
