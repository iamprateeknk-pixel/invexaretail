# Security and hardening review (blueprint v4, P8)

What was checked, what was found, what changed, and what is still open.

## Checked and found sound
- **Authentication coverage.** `api/src/routes/route-auth-coverage.test.ts` enumerates every route on the operational routers and calls it with no credentials. None answers. The test fails if a new route is added without a guard.
- **Injection.** No raw SQL is built from request data (`$queryRawUnsafe` calls use `?` parameters; the only interpolated SQL is schema DDL from constants). No `eval`, `child_process` or redirects.
- **Transport and abuse.** Helmet, CORS allow-list, a 240/min API rate limit and separate login / OTP limiters are in place. `JWT_SECRET` is mandatory in production.
- **Role checks on new surfaces.** Command center and reports: admin, branch manager, auditor (branch managers see only their branches). Audit export: admin and auditor. Operational metrics: admin only. Covered by `chaos-authz.http.test.ts`.

## Found and fixed
| Finding | Fix |
| --- | --- |
| A failed database write left the count in memory, so a retry was answered "already done" for something never saved, and it vanished on restart. | `recordThenPersist` withdraws the in-memory record when the write fails. Weight counts are all-or-nothing and are rolled back as a set. |
| Two identical weight-count requests at once could see a half-written set. | In-flight guard per user + request id. |
| A retried transfer receipt after the transfer completed returned 400 instead of the recorded result; without a database it could post stock twice. | Receipt register checked before the status gate, in-flight guard, requestId bound to one transfer. |
| A failed QC inspection still let goods become sellable. | Verdict-aware gate: a failed inspection sends the quantity to quarantine. |
| Marketplace order webhooks were not idempotent. | Platform + external id dedupe, serialised per key. |
| CSV export of the audit trail could carry spreadsheet formulas (`=`, `+`, `-`, `@`). | Cells starting with those characters are prefixed with an apostrophe. |

## Open (not fixed here)
- **Audit events carry no company id.** The command center and the export now show only the actions of the company's own users (plus system/connector actions), but a proper `companyId` on `AuditEvent` is the durable fix for a multi-tenant rollout.
- **PO and returns routes were verified by typecheck and pure-logic tests only**, because they need MySQL. Exercise them once on staging.
- **Metrics are in-process.** They reset on restart and are per instance. Ship them to a metrics backend before scaling out.
- **`npm audit` (API, production deps): 6 findings, all inside Prisma's own bundled tooling** (`mysql2`, `mariadb`, `deepmerge-ts` under `node_modules/prisma`). The fix is a breaking Prisma major upgrade (`npm audit fix --force` would install prisma 6.x), so it was not forced. Plan it as its own change with a staging run. Web: 0 findings.

## Failure and load tests added
- Ten simultaneous identical requests for a count, a weight count and a transfer receipt each produce exactly one effect.
- `scale.test.ts`: 60 branches, 50,000 counts / audit events and 5,000 transfers through the command center and reports; 5,000-item purchase plan; a 2,000-lot KG allocation. All finish well inside their limits.

## Added after the first pass
- `(channel, externalReference)` is now a unique index on `Order` (migration + self-heal; skipped with a warning if old data already holds duplicates), on top of the per-key in-process lock.
- A pick slip is retry-safe (`requestId`), never takes a blocked, expired or empty lot, and KG picks are allocated by the server.
