# Plan 10/10 tracker

State as of 2026-10-07, branch `feat/plan-10of10`. Source: "Invexa Retail 10 of 10 Master Development Implementation Plan (Ultimate UI/UX)".
Status is `done` (code + test evidence), `partial` (shipped slice, named remainder) or `open` (not started / cannot be done from this repository).

| Area | Item | Status | Evidence / remainder |
|---|---|---|---|
| A Architecture | Snapshot reconciled off the request path | done | `lib/repository-reconciler.ts` + test; `/ops/metrics` `reconciliation` |
| A | Database-first reads, drop in-memory snapshot | open | Large refactor; snapshot is now background-reconciled, not removed |
| A | Remaining `core.ts` Transfer routes extracted | open | `docs/route-ownership-matrix.md` |
| B Stock integrity | Canonical posting, job consumption in one transaction | done | `lib/job-consumption-service.ts` + 8 Postgres tests |
| B | Nightly reconciliation with evidence | done | `lib/stock-reconciliation.ts`, `reconciliation_runs` migration, 6 Postgres tests |
| B | Virtual bundles/kits | done | `routes/bundles.ts`, contract entries |
| B | Remaining Float -> Decimal fields | partial | Slices 4 (rule thresholds) and 5 (PriceList.price, plus a price-read tenant fix) shipped, 11 tracked money Floats left (PurchaseOrder/Invoice costs and totals, Item.mrp, shipping cost per km ...); `docs/decimal-migration-plan.md` |
| C | Item photos, user permissions, pick waves, bins, putaway tasks company-scoped | done | 404 on foreign ids; Postgres suites `core-photos-permissions`, `warehouse-tenant` (both fail on the old code) |
| C | Webhook subscriptions/deliveries, approval requests, saved reports, serial numbers and command-center counts company-scoped | done | Events deliver only to the producing company's hooks (unattributable events are dropped); migrations `20261118090000`, `20261119090000`; Postgres suites `operations-extension-webhooks`, `tenant-sweep-approvals-reports-serials`, unit tests in `webhook-dispatcher.test.ts` |
| C | Approval/tolerance/evidence rules and QC templates company-scoped | done | Lists, PATCH (404 on foreign id) and `checkApprovalGate`; Postgres test fails on the old code |
| C Tenant security | Asset checkouts, lots, comments, notifications company-scoped (404 not 403) | done | Migration `20261114090000`; 9 negative cross-tenant Postgres tests that failed on the old code |
| C | Lint covers all tenant models | done | `scripts/architecture-lint.mjs` widened, baseline regenerated |
| D Auth | Non-enumerating OTP, password policy, session revoke on disable/change | done | `otp-privacy.http.test.ts`, `admin-user-security.http.test.ts` |
| D | TOTP two-factor with backup codes and lockout | done | `UserTotp`/`AuthLockout`, `/auth/2fa/*` |
| D | Passkeys / WebAuthn | open | Not started |
| D | Control Plane session handoff | partial | One-time 60 s code instead of the session in the URL (`lib/saas/session-handoff.ts`, `/control/v1/sessions/handoff[/exchange]`, 7 tests); web control session now in sessionStorage, admin-panel clears its copy. True HttpOnly cookie not possible across the two origins; handoff store is in-memory (single API replica) |
| E Realtime/perf | Event-first polling with safety poll | done | `lib/poll-policy.js` + test |
| E | Exactly-once mutation replay (`X-Mutation-Id`) | done | `lib/mutation-idempotency.ts` unit + Postgres tests |
| F Web UX | Role landing pages, no offline write queue, fail-clearly policy | done | `lib/workspace.js`, `lib/offline-policy.js` + tests |
| F | DataTable state: URL query, per-user saved views, density | partial | `lib/table-state.js` + 9 tests. `components/ui/table-toolbar.jsx` (search, density, saved views; 3 RTL tests) adopted on Exceptions, Orders, Purchase orders, QC inspections, Assets, Jobs, Transfers, Count tasks and Connectors (`hooks/useTableView.js`). state is synced to the URL hash query (`#/orders?q=rice`), so refresh, shared links and manual edits keep it; saved views are not yet shared across users |
| F | Playwright golden journeys (4 of 5 missing) | open | Not runnable in this environment |
| G/H Mobile | Identity-bound offline queues, retry classifier, backoff, ordering, single-flight refresh | done | `offline_identity_test.dart`, `sync_resolution` tests |
| G | Environment/flavor hardening, lazy tabs | done | `env_test.dart`, `tab_state_test.dart` |
| H | Single SQLite outbox | partial | Schema v4 moves queued counts/actions into `sync_commands` (migration + coexistence tests). Typed-command producers and cold-start offline read model still open; device verification needed |
| H | Admin view of stuck/poison sync work | partial | `GET /ops/sync-health` (`lib/sync-health.ts`): completed/in-flight/stuck receipts per company with a sample; Postgres test incl. tenant isolation. Device-local conflict/reject queues are not visible server-side |
| I Testing/CI | Migration matrix (fresh, upgrade, restore) | done | `scripts/migration-matrix.mjs` + CI step |
| I | Blocking audit gate with owned, expiring exceptions | done | `scripts/audit-gate.mjs`, `security/audit-exceptions.json` (expire 2026-12-31) |
| J Deployment/DR | Canonical runbook, CODEOWNERS, PR template | done | `docs/PRODUCTION_RUNBOOK.md`; restore drill 95 tables / 77 rows identical |
| J | Managed-database restore drill, staging canary | open | Needs real infrastructure |
| J | Remove committed `api/dist` | done | Untracked and ignored; Docker and `postinstall` build it from source; CI step fails if it is tracked again |
| K API contract | OpenAPI v2026.16.0: bundles, 2FA, reconciliation, `X-Mutation-Id`, sign-in/session, sync health, webhooks, approvals | partial | 38 paths documented; most other routes still open |
| L Readiness | Release scorecard updated | done | `release-scorecard.md` |

## What still blocks a GO

Everything marked `open` above, plus the owner-only items in the scorecard (branch protection, signed build, hosting decision).
The API (Railway) has not been redeployed with this work: new migrations apply on deploy and `JWT_SECRET` must be set or the API refuses to start in production.
