# Release scorecard (Week 20 gate) - state as of 2026-10-07 (see plan-10of10-tracker.md for the item-level status)

**Recommendation: NO-GO.** Only the human owner can approve production; this page records why the gates are not yet green.

| Dimension | Pass condition (guide) | State | Blocking evidence still needed |
|---|---|---|---|
| Data integrity | Zero unexplained stock delta; all mutation paths canonical | **Mostly met** | Reconciliation 11/11 explained, 0 mismatches after the opening-journal backfill; no Float money fields; concurrency suites green. Still open: some legacy stock-write call sites remain allowlisted (`docs/inventory-posting-coverage.md`) |
| Security | No P0/P1 auth/tenant issue; replay/isolation suites pass | **Met in code** | Tenant sweep closed ~20 cross-company leaks, each with a negative test that fails on the old code; 2FA, lockout, non-enumerating OTP, one-time handoff codes. Dependency exceptions are owned and expire 2026-12-31 |
| Reliability | Backup/restore, migration rollback, worker replay pass | Partial | Migration matrix (fresh/upgrade/restore) green; local rollback rehearsal passed (older release on newer schema, reads and writes); managed-database restore and Railway rollback not rehearsed |
| Performance | p95 budgets pass at target volume | Partial | Local read probe at 20k items: all four endpoints p95 <= 163 ms (budget 500). Mutations, managed DB and staging not measured |
| UX | Five golden journeys pass desktop/tablet/mobile + keyboard | Partial | Shared DataTable pattern, Entity 360, a11y names verified on all 28 sections in a real browser, no overflow at 375 px; 3 Playwright specs authored (not executed here); no usability tests |
| Mobile | Signed build, secure storage, real offline DB, sync recovery | Partial | One SQLite outbox, offline read model (cold-start snapshot), identity-bound queues, no second login; **no signed build and no device matrix** |
| Observability | Trace, logs, SLO alerts, business reconciliation visible | Partial | Reconciliation, sync health and outbox SLOs queryable and pushed to `ALERT_WEBHOOK_URL` (tested); no collector, hosted dashboard or configured destination |
| Documentation | README, ADRs, API, deploy, rollback, incident docs current | Mostly met | Canonical runbook with rollback and incident handling, evidence package, tracker; OpenAPI covers 41 paths, not every route |
| Governance | Protected main, review gates, evidence, release owner | Unverified | Branch protection, required reviewers, signed tag and SBOM cannot be checked from the repository |
| Operations | Canary and rollback exercised; 30-day review scheduled | **Not done** | Local rollback rehearsal only; canary needs a staging/canary environment |

## Five golden journeys (guide) - automation state

| # | Journey | Automated evidence today |
|---|---|---|
| 1 | PO receipt -> lot -> accepted stock -> audit/report agreement | Unit/HTTP coverage of PO receive; no end-to-end reconciliation run |
| 2 | Transfer with short/damaged receipt -> QC -> source/in-transit/destination reconciliation | Transfer HTTP tests; reconciliation not asserted |
| 3 | Blind count offline -> conflict -> recount -> approve -> post once | Assignment + contract logic tested; no mobile/server E2E |
| 4 | Marketplace order replayed twice -> one order, one reservation, reconciled return/refund | Replay -> one order and cross-tenant rejection tested (memory mode); return/refund leg not covered |
| 5 | Overlapping IDs across two tenants -> zero cross-tenant access | Item repository (5,200 items) and seven route-slice Postgres suites |

## Update 2026-10-07 (checklist completion)

The full evidence is in [release-candidate-evidence.md](release-candidate-evidence.md); item-level status is in
[plan-10of10-tracker.md](plan-10of10-tracker.md). What changed since the table was first written: every code-level item in the plan's
section 20 checklist now has evidence in the repository, and what remains is verification that needs devices, a staging stack or people
(Android golden journeys, usability tests, a production-like load run, a managed restore and rollback drill, configuring the alert destination).

**Recommendation: NO-GO until those are done** - a smaller, better-defined gap than before, with every remaining item named and owned.

## Exceptions register

None approved. The two dependency-audit exceptions in `docs/security-gates.md` are *proposed* and need an owner and an expiry sign-off.

## Owner sign-off (to be completed by the human owner)

All P0/P1 closed or rejected: **No** · Invariants proven: **No** · Five journeys pass on the release candidate: **No** · Backup/rollback/canary rehearsed: **No** · Mobile scope: **undecided** · Hosting path approved: **undecided** · Go decision: **No-go**.
