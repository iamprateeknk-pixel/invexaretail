# Release scorecard (Week 20 gate) - state as of 2026-09-25

**Recommendation: NO-GO.** Only the human owner can approve production; this page records why the gates are not yet green.

| Dimension | Pass condition (guide) | State | Blocking evidence still needed |
|---|---|---|---|
| Data integrity | Zero unexplained stock delta; all mutation paths canonical | **Not met** (much closer) | On-hand paths for PO/transfer receipt, pick-confirm, counts, orders, expiry and returns now post canonically and atomically. Still open: `reserved`/`inTransit`/`quarantine` dimensions, legacy bulk-import writes, and Float->Decimal (`docs/inventory-posting-coverage.md`) |
| Security | No P0/P1 auth/tenant issue; replay/isolation suites pass | Partial | Replay/isolation suites exist and pass; the covered `unscoped-tenant-query` baseline is now zero after the marketplace, OMS, import, count, expiry, return and exception slices. Dependency-audit exceptions still need owner acceptance (`docs/security-gates.md`) |
| Reliability | Backup/restore, migration rollback, worker replay pass | Partial | Local restore rehearsal only; no staging restore, rollback or replay drill |
| Performance | p95 budgets pass at target volume | **Not measured** | No load test; budgets are proposals (`docs/slo-and-alerting.md`) |
| UX | Five golden journeys pass desktop/tablet/mobile + keyboard | Partial | Item-search journey has Playwright coverage; the other four journeys have none |
| Mobile | Signed build, secure storage, real offline DB, sync recovery | Partial | Real SQLite + secure storage in code and tested; **no signed build (no keystore secret) and no device matrix** |
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
