# Execution-guide status (real guide, Weeks 1-20)

Source: `Invexa_Retail_20_Week_Developer_Execution_Guide.docx` (v1.0, 21 September 2026). Its rule: *a week is complete only when code, tests, evidence and owner acceptance agree - a merged PR alone is not completion.*

Assessed 2026-09-25 by reading code, tests and docs and by running the suites named below. **Nothing here has staging, device, load or owner-acceptance evidence**, so no week is "accepted" - the columns say what exists in the repository.

## Correction of the record

`AGENTS.md` and the `docs/weekNN-*.md` files for Weeks 12-20 were written when this guide could not be found, so those weeks were *inferred* and do **not** match the guide:

| Repo "Week N" doc | What it actually is | Guide's Week N |
|---|---|---|
| week12 reporting/exception dashboard | dashboard read model | Stock Count Campaigns + offline contract |
| week13 contract catch-up | OpenAPI additions | Transfer / Warehouse / QC vertical slice |
| week14 outbox retention | outbox pruning | Procurement, landed cost, 3-way match |
| week15 tenant-scope lint | lint coverage | OMS ingest, returns, refunds |
| week16 state-transition lint | lint rule | Real mobile offline DB + secure storage |
| week17-19 tenant `companyId` slices | schema migrations | Android release / reporting-admin-docs / CI-security |
| week20 retrospective | verification only | Release candidate, canary, sign-off |

That work is real and useful (and stays), but it is not the guide's Weeks 12-20. Treat the table below as authoritative.

## Status by guide week

Legend: **Done** = implemented and tested in-repo · **Partial** = some of the scope · **Open** = not started · **Human/env** = needs staging, devices, or an owner decision that code cannot supply.

| Wk | Guide outcome | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Containment, restore proof | Partial | `docs/release-evidence/week-01-containment/` (local restore rehearsal). **Human/env:** isolated *staging* restore, risk-owner assignment, baseline tag/milestone |
| 2 | ADRs + repo rules | Done | ADR-001..006, `AGENTS.md`, `scripts/architecture-lint.mjs` (0 new violations; 17 documented Float fields and one legacy runtime-DDL reference remain tracked) |
| 3 | Sessions, OTP, secrets | Done (in-repo) | `lib/session-store.ts` + Postgres replay test; mobile secure storage. Browser HttpOnly-cookie flow not re-verified in this pass |
| 4 | Tenant repositories | Partial | Item repository is the reference; the tenant-scope remediation now leaves **zero** `unscoped-tenant-query` baseline violations across the linter's covered operational models. Identity/Organization repositories are not yet migrated to the typed repository pattern |
| 5 | Schema authority, Decimal prep | Partial | Migrations authoritative, runtime DDL retired. **Decimal conversion not executed** (`docs/decimal-migration-plan.md`) |
| 6 | Canonical stock journal | Partial (large step made) | `InventoryPostingService` gained `postInventoryMovementInTransaction`. PO receipt, transfer receipt (destination) and pick-confirm (source), count-variance approval, order fulfilment, both expiry write-offs, return restock/disposition, job consume and exception restock now post through it *inside their own transactions*, each with a real-Postgres test (retry = one journal row, journal sum = on-hand, failure = no partial write). Fixed on the way: PO receipt's journal row was written after commit with errors swallowed; transfer receipt wrote no journal row at all. **Still baseline:** the `reserved`/`inTransit`/`quarantine` dimensions (reservation, dispatch in-transit), `import-reversal.ts` and legacy opening-stock/daily-import writes (`docs/inventory-posting-coverage.md`) - closing them needs a service command for those dimensions, a design decision. So the "all mutation paths canonical" gate is still **not fully met** |
| 7 | Atomic reservation, transitions, outbox | Done | `lib/reservation.ts`, `outbox-worker.ts`, `domain-policies.ts`, error catalog, Postgres suites |
| 8 | API modularisation + contract | Partial | Transfers, Branches, Items, Imports, Reports extracted; `core.ts`/`operations-extension.ts` still large; `api/dist` still committed (Hostinger path) |
| 9 | IA + design system | Done | `docs/web/*`, shared components + tests. Admin-panel token consolidation open |
| 10 | Dashboard / item search / stock detail | Done | Postgres 5,200-item suite, Playwright journey. **Also fixed:** `POST /items/:id/adjust` and `.../reverse` had no role check, so any authenticated role could post stock straight to the API; now admin-only (`routes/items.authz.test.ts`, existing Postgres suite still passes) |
| 11 | ERP import lifecycle | Done in-repo (needs staging proof) | Lifecycle, checkpoint, 5,000+ row Postgres suite. **Added:** the import wizard (`web` section `import-wizard`, `components/imports/ImportWizard.jsx`, `hooks/useStagedImport.js`, `lib/staged-import.js`): CSV upload/paste -> preview & validate -> confirm (per-type policy: opening stock is all-or-nothing) -> live progress (survives reload, the batch id is the state) -> failed-rows CSV -> reverse; 7 helper tests + 4 component tests (keyboard, roles, states). **Also fixed:** the staged-import API had no role check - any authenticated user (store user, picker) could stage, commit and reverse stock imports; now admins only for writes, auditors may read (`routes/imports.authz.test.ts`). Not done: browser E2E of the wizard against a live API |
| 12 | Count campaigns + offline contract | Partial | **This pass:** `planFairAssignment` reproduces the guide's examples exactly (100/3 users -> 33/33/34; cap 20 -> 20/20/20, 20/20/20, 10/10) with duplicate/drop/determinism tests; `offline-command-contract.ts` + tests. **Not done:** `runCampaignDay` still uses the older top-up allocator (rollover semantics) rather than `planFairAssignment`; the guide's state names (submitted / variance-review / posted) differ from the campaign states; approved-variance single-post through `InventoryPostingService`, concurrent-approval and browser E2E not evidenced. The "final 10/10 to two users" tail rule is an *interpretation* of the example - **owner to confirm** |
| 13 | Transfer / warehouse / QC slice | Partial (existing) | Lifecycle, picker, putaway, bins, waves, replenishment, thermal PDF, exceptions/QC, evidence rules all exist with unit/HTTP tests. Not evidenced: two-picker race, short/damaged source-in-transit-destination reconciliation, destination live document. Transfer stock movement is a baseline (non-canonical) path |
| 14 | Procurement / landed cost / match | Partial (existing) | PO lifecycle, `landed-cost.ts`, `three-way-match.ts`, supplier score exist. Money is `Float` (Decimal not executed); PO approval threshold matrix not verified |
| 15 | OMS ingest / returns / refunds | Partial | **Found and fixed against real Postgres:** the marketplace webhook could never have worked in production. (1) It was mounted *after* routers that `router.use(requireAuth)`, so every real delivery got 401 (now mounted first, with a static ordering test and a live-server check). (2) It created orders with `createdById: 'connector'`, an FK violation on every delivery (now a per-company non-loginable service user). Added the durable `ChannelWebhookEvent` log (migration `20261105090000`, unique `(connectorId, eventId)`, key = `X-Invexa-Event-Id` or the order reference, states RECEIVED/PROCESSED/REJECTED/FAILED, event -> order link); a replay is one order and one reservation. Earlier: the signed webhook resolved SKUs and fulfilment locations with **no company filter** (a connector could order another company's items and reserve its stock) - fixed, extracted to `routes/marketplace-webhook.ts`, audited with payload checksum, 6 regression tests (memory mode). **Not done:** out-of-order handling (order-creation webhooks have no ordering to violate; status webhooks do not exist yet), return-inspection/refund flow evidence |
| 16 | Real mobile offline DB + secure storage | Partial | **This pass:** real SQLite with migrations/transactions, durable command queue, legacy-file migration, XOR `SyncVault` removed, Orders navigation fixed, WebView permissions restricted - `flutter test` 70 pass, analyze clean, release APK builds. **Human/env:** device tests. The screens' queue already syncs through the existing idempotent endpoints (per-item `requestId`, 409 -> Conflict Center) and is now persisted in real SQLite; the versioned `sync_commands` layer is built but no screen enqueues into it and no server route consumes it - deliberately not switched on without a device to verify (see the offline doc). Details in `docs/offline-contract-and-mobile-store.md` |
| 17 | Android release + devices | Partial | **This pass:** CI no longer regenerates the project or `sed`-patches the manifest; Flutter 3.47.2/JDK 17 pinned; lockfile enforced; signing from secrets with a hard fail if unsigned on main; AAB + APK. **Human/env:** real keystore secrets, device matrix, install/upgrade evidence, **iOS decision (owner)** - no iOS build exists, so it is unsupported today |
| 18 | Reporting, audit, admin, docs | Partial | README rewritten from the code (old one archived), security/SLO docs and an incident-response section in `docs/PRODUCTION_RUNBOOK.md`. **Added:** explicit report timezone (`lib/report-range.ts`: date-only bounds are whole days in `timezone`, default Asia/Kolkata; the three report routes and the audit export share one resolver, and the old string comparison that dropped the last day is gone); API-key rotation (`POST /control/v1/integrations/api-keys/:id/rotate`, audited, token shown once); signed, expiring, company-bound evidence links (`routes/evidence-access.ts`). **Not done:** malware scanning and object storage (need infrastructure), Assets/Projects scope decision (owner), audit completeness review, clean-developer rehearsal |
| 19 | CI, security, observability, load, drills | Partial | **This pass:** `security.yml` (CodeQL, dependency audit, gitleaks, Trivy), OpenTelemetry tracing (opt-in), CI now runs *every* Postgres suite instead of a hand-kept list that had drifted by twelve suites (all 20 suites were run locally against Postgres 17 this pass and pass; running them together exposed an order dependence in `outbox-worker.postgres.test.ts`, which now clears the outbox first), SLO policy. **Human/env:** load test at approved volume, failure drills, dashboards/alert routing, cross-platform E2E |
| 20 | Release candidate + sign-off | Open (Human) | `docs/release-evidence/release-scorecard.md` records the gate state; only the owner can sign go/no-go |

## Decisions that need the owner

1. Tail rule for the last partial count batch (10/10 across two users) - confirm or replace.
2. Whether `planFairAssignment` should replace the daily top-up allocator in `runCampaignDay`, and whether "no daily cap" must become an explicit campaign setting (today `dailyItemsPerUser` is 1-500).
3. iOS: supported now / later / out of scope.
4. Approve or change the SLO numbers in `docs/slo-and-alerting.md`; choose the metrics/alerting backend.
5. Accept or reject the time-boxed dependency-audit exceptions in `docs/security-gates.md`.
6. Assets/Projects: keep (with tenant hardening) or archive.
