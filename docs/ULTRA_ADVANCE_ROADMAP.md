# Ultra-Advance Roadmap — Invexa Retail

*Created 23 Oct 2026, from the Round-2 deep audits (Deploy / Flow / System) run against main after the
six-phase remediation. This document is the tracked plan for everything those audits found that the
first response waves did **not** already fix. Each programme below has a matching `[ULTRA]` GitHub
issue; this roadmap is the index, the issues are the work orders.*

---

## 1. Where we stand

### Round-2 audit scores (at audit time, main ≈ `7d2f00ce`)

| Audit | Score | One-line verdict |
|---|---|---|
| Deploy / DevOps | **5.5 / 10** | CI and code foundation strong (7+), but deploy gating, config-as-code, volumes and backup evidence lived in dashboard memory and manual steps. |
| Business Flow | **6.5 / 10** | The posting *engine* is 8–9/10 (transactional, idempotency-keyed, tenant-scoped, compensating reversals); the *edges* (returns, transfer housekeeping) could invent or strand stock. |
| System / Architecture | **7.0 / 10** | Security posture, idempotency contract, tenant indexing and the mobile sync engine are above typical production SaaS; the read architecture and control-plane state cap the scale ceiling. |

### What Waves 1–4 already fixed (landed on main)

| Wave | PR | What it closed |
|---|---|---|
| Wave 1 — Returns hardening | **#178** | Flow **P0-1/P0-2/P0-3** (duplicate-line over-return cap, non-transactional return create, disposition race) and **P1-1** (RECEIVE made atomic/idempotent per line) — the only paths that could create stock from nothing. |
| Wave 2 — Deploy pack | **#179** | Deploy **P0-2/P1-5** (`api/railway.json` as code, single migration path, Dockerfile CMD aligned, Procfile removed), **P1-6** (`.env.example` regenerated from the runbook contract; `ENABLE_DEV_OTP=true` now fails `production-guard.ts`), **P2-8** (StockBalance deploy gate as code in `db:verify`), **P2-5** (stale `verify.yml` removed; `ci.yml` is the single gate). |
| Wave 3 — Transfer / order lifecycle | **#181**, **#182** | Flow **P1-2..P1-10**: reservation released on transfer delete, delta-adjusted on edit, awaited release + create idempotency, order-fulfil replay no longer double-releases, replenishment ids company-namespaced, expiry reads company-scoped, pick-wave creation tenant-scoped. |
| Wave 4 — System quick wins | **#180** | System **P1-4** (distributed lock pinned to a dedicated connection — no more silent missed scheduler runs), web client now sends `X-Mutation-Id` (server idempotency finally used by web), web root/per-section **error boundaries**, PIN/legacy-hash hardening, single audit write path, `default-company` schema defaults removed. |

Everything in §2 below is what **remains** — deliberately not touched by the waves because each item
is a programme, not a patch.

---

## 2. The remaining programmes

### P1 — Eliminate the snapshot read-path *(System P0-1)* — Effort: **L**

**Problem.** Operational API reads are served from a per-process in-memory snapshot. Every replica
re-hydrates the **entire** multi-tenant database (all companies' items+lots, transfers+lines,
counts, users) on a 30 s timer: reads are 0–30 s+ stale, DB load scales linearly with replica count,
memory footprint equals the whole dataset × replicas, and one large tenant taxes every other tenant.

**Code anchors.** `api/src/lib/repository.ts` (module-level mutable arrays);
`api/src/lib/persistence.ts` `hydrateRepositoryFromDatabase()` (unbounded, unpaginated loads;
`transferCarton.findMany` at ~line 170 with no company filter and no `take`);
`api/src/lib/repository-reconciler.ts` (30 s full refresh, keeps serving last-good snapshot
indefinitely on failure).

**Approach.** Migrate route families one by one onto `api/src/lib/repositories/*` (the pattern
Phase 5 proved for stock), tenant-scoped DB queries in the request path. As the bridge step, make
the reconciler delta-based (`updatedAt` watermark + `DomainEventOutbox` cursor) and hydration
company-scoped/lazy. Snapshot may survive only for small reference data (locations, rules).

**Acceptance evidence.** No full-table hydration in the request path (code + load test);
reconciler shown delta-based with watermark metrics on `/ops/metrics`; read staleness bounded and
visible; API memory no longer proportional to the full dataset; Postgres integration suites green.

### P2 — Control plane to real DB tables *(System P0-2)* — Effort: **L**

**Problem.** The SaaS control plane (plans, companies, sessions, API keys, billing, invoices, usage,
kill switches, devices) lives in in-memory `Map`s on one class instance, persisted as a single
debounced JSON blob that is loaded only at startup. Two replicas = two truths: API keys minted on
replica A 401 on B, usage limits are effectively N× loose, a kill switch set on one replica does
not stop the other, and concurrent blob saves are last-writer-wins (silent loss of
companies/sessions/billing).

**Code anchors.** `api/src/lib/saas/control-plane.ts` (~lines 337–363, the state Maps);
`api/src/lib/saas/persistence.ts` (single-row `ControlPlaneState` JSON snapshot);
`hydrateControlPlaneFromStore()` called only from `api/src/index.ts` startup; no periodic reload.

**Approach.** Promote the entities to real Prisma tables (companies, apiKeys, sessions, usage,
billing, kill-switch state), usage as atomic DB increments, kill switch evaluated per request via
a version check / outbox invalidation. Interim band-aid if sequencing requires: versioned snapshot
+ 15–30 s version-check reload (smaller loss window, still race-y — label it as such).

**Acceptance evidence.** Two-instance test: key created on A authenticates on B; kill switch on A
stops B within the bounded window; plan usage enforced across replicas (not N×); no blob overwrites
in the persistence path.

### P3 — Validation + error-envelope unification *(System P1-8, P2-9)* — Effort: **M**

**Problem.** `zod` is a declared dependency with **zero** imports in `api/src`; all 46 route files
validate by hand, inconsistently — a missed check becomes a 500 or a bad write, and clients face
three error envelope shapes (~765 `{message}`, ~140 `{error, code}`, ~117 `{success}` sites).

**Code anchors.** `api/package.json` (`zod ^4.5.4`); `grep "from 'zod'" api/src` = 0 files;
`api/src/lib/errors.ts` (ADR-006 domain envelope — adopted only on reservation/transition/outbox
paths).

**Approach.** One `validate(schema)` middleware; zod schemas on every mutating route, starting
with money/stock families (transfers, imports, counts, returns); one response-envelope helper;
an architecture-lint rule (the lint already exists) that fails CI on new raw-envelope responses.

**Acceptance evidence.** All mutating routes in the named families schema-validated; invalid
payloads return the single envelope with 400 (contract tests); lint rule live in CI; envelope
shape count in routes converges to one.

### P4 — Realtime & jobs at scale *(System P1-3 + outbox gap)* — Effort: **M**

**Problem.** In DB mode every SSE connection polls the outbox table every 1 s (≈500 qps of polling
at 500 users, against a 10-connection pool), and the total-stream cap reads an in-memory registry
that DB mode never populates — the cap is decorative. Separately, the common event path publishes
fire-and-forget *after* commit, so a crash in the gap loses stock events; the transactional outbox
helper exists but only some callers use it.

**Code anchors.** `api/src/routes/events.ts` (`setInterval(…, 1000)` per connection,
`durableEventsSince()`); `api/src/lib/event-bus.ts` (`MAX_STREAMS_TOTAL` counted from the
in-memory `subscribers` Map; ADR-006 comment admitting the crash gap; per-user stream Map is
per-process).

**Approach.** Postgres `LISTEN/NOTIFY` on outbox insert with one shared listener per instance and
local fan-out (interim: adaptive 2–5 s poll + jitter). Stream counters DB/Redis-backed, or caps
honestly declared per-instance. Make `recordOutboxEventInTransaction` **mandatory** for all stock
mutations, enforced by lint/test.

**Acceptance evidence.** The SSE harness (`api/scripts/sse-reconnect-harness.mjs`) at target
connection counts meets the proposed latency thresholds without per-connection polling queries;
caps demonstrably enforced in DB mode; crash-during-commit test shows zero lost stock events.

### P5 — Data-history protection *(System P1-19, P2-20)* — Effort: **M**

**Problem.** There is no soft-delete anywhere: 0 `deletedAt` models, ~144 relations with only 26
explicit `onDelete` — all `Cascade`. Deleting an item deletes its stock-ledger rows, so history
(and the audit story) dies with the master record. The ledger is a mutable balance dual-written
with the movement journal, and a nightly reconciliation job exists precisely because the two drift.

**Code anchors.** `api/prisma/schema.prisma` (no `deletedAt`; cascade defaults);
`api/src/lib/item-master-service.ts` (~line 146, `stockLedger.deleteMany` on item delete);
`api/src/lib/stock-reconciliation.ts` + `api/scripts/reconcile-stock-journal.mjs`.

**Approach.** `deletedAt` + archive policy for master entities (Item, Location, Supplier, User);
ledger/movement rows are **never** hard-deleted (reversals only); `Cascade` → `Restrict` wherever
history attaches; declare the journal the single source of truth and the ledger a rebuildable
projection; reconciliation becomes verify + alert, not silent repair.

**Acceptance evidence.** Item delete leaves full ledger history intact and queryable; delete paths
covered by tests; reconciliation report over a staging window shows zero unexplained drift.

### P6 — Remaining flow hardening *(Flow P1-6, P1-11, P1-12, P2-11 + returns requestId)* — Effort: **M**

**Problem.** Four seams still do read-then-write across requests where the layer below them does it
properly: pick slips validate cumulative picked quantity against a snapshot (two pickers can
over-pick; confirm never re-caps allocations against requested lines); an admin can approve their
own ad-hoc count (segregation-of-duties hole, documented as intentional); weight counts commit lot
by lot with compensation instead of one transaction; refresh-token issuance writes outside the
rotation transaction (a rollback can leave two live tokens in one family). Return creation still
has no client `requestId` column to dedupe against.

**Code anchors.** Pick-slip POST + confirm allocation path (`api/src/routes/core-picking.ts`,
`api/src/lib/persistence.ts`); count review (`api/src/routes/core-counts.ts`); weight count
(`POST /stock-counts/weight`); `api/src/lib/session-store.ts` (`rotateRefreshToken` /
`issueRefreshToken` uses the top-level client, not `tx`); `ReturnRequest` model in
`api/prisma/schema.prisma` (no `requestId`).

**Approach.** Serialize slip-saving per transfer (row lock or conditional status claim) and re-cap
allocations per line at confirm; block self-review unconditionally (second approver above a
variance threshold); weight count in a single DB transaction (or a resumable batch id); thread
`tx` through token issuance; add `requestId` to `ReturnRequest` with a unique constraint.

**Acceptance evidence.** Concurrency tests: two-picker over-pick rejected, replayed creates dedupe,
self-approval rejected with 409, rotation rollback leaves exactly one active token in the family.

### P7 — Platform depth *(System P1-11, P2-13, P2-21; Deploy P1-4, P2-1)* — Effort: **M** (items S–M each)

**Problem.** One `JWT_SECRET` derives everything (sessions, signed evidence links, webhook
encryption, OTP hashes) — one leak forges all of it, and rotation invalidates all of it at once.
API keys are scoped by HTTP method only (a key can read, or write *everything*). Item photos live
as `Bytes` inside Postgres. Money math still runs through JS floats on valuation paths. API logging
is `morgan('dev')` + scattered `console.*` (no structured JSON, no error-tracking hook). And boot
still runs runtime DDL (`ensureDailySyncSchema`) against the migrations-only policy.

**Code anchors.** `api/src/lib/signed-access.ts` (secret derived from `JWT_SECRET`);
`api/src/lib/production-guard.ts` (its own comment admits the single-secret coupling);
`api/src/routes/enterprise-auth.ts` (`apiKeyAllowsMethod`); `api/src/lib/item-photos.ts` (DB
`Bytes`); `api/src/lib/decimal-json.ts` + float valuation (`api/src/lib/exceptions.ts`,
`lib/entity-360.ts`); `api/src/index.ts` (`morgan('dev')`); `api/src/lib/runtime-schema.ts`
(`ensureDailySyncSchema`).

**Approach.** Per-purpose keys via HKDF with purpose labels (or separate env secrets) and a
dual-verify rotation window; API-key scopes to `resource:action`; photos to object storage (S3/R2)
behind the existing signed-access pattern; valuation/landed-cost math in `Prisma.Decimal` end to
end (numbers only at the JSON boundary); structured JSON logger (pino) with request-id correlation
replacing `morgan('dev')`; fold every runtime-DDL statement into real migrations and make boot
read-only.

**Acceptance evidence.** Per-purpose rotation drill invalidates only that purpose; a scoped key is
denied outside its scope (test); photo reads served from object storage; valuation matches a
Decimal reference to the paisa; production logs are JSON with request ids; boot performs zero DDL
(migration log is the only schema writer).

### P8 — Mobile & forecasting depth *(System P1-17, P2-18, §8 gaps)* — Effort: **M**

**Problem.** The mobile offline engine is genuinely strong (ordered SQLite migrations, conflict
classification, optimistic versions) but sync only flushes in the foreground — a killed app means
counts/transfers sit unsynced until the next manual open. There is no crash reporting (a field
crash's only signal is a phone call) and the app is Android-only. Demand forecasting is a trailing
average × days: no trend, no seasonality, no accuracy tracking.

**Code anchors.** `mobile/pubspec.yaml` (no workmanager/background-fetch, no crash package);
`mobile/lib/state/session_controller.dart` (flush triggers are foreground-only);
`api/src/lib/demand-forecast.ts` (~lines 22–28, trailing average + stddev only).

**Approach.** WorkManager periodic + one-shot sync tasks with a headless-safe flush (Android
first); crash reporting (Sentry Flutter or Crashlytics) wired to the existing server sync-health
surface; forecasting upgraded to trend + seasonal indices (Holt-Winters class) with a
forecast-accuracy loop (MAPE vs actuals) feeding reorder decisions. iOS stays a business decision,
recorded as far-future.

**Acceptance evidence.** App killed → queued work flushes on schedule (device evidence); crash
reports visible in a dashboard; forecast MAPE measured against history and beating the
trailing-average baseline.

---

## 3. Platform / user-owned gates (not code — settings, drills, evidence)

These cannot be closed from the repo. Each needs the account owner or a real environment:

1. **CI-gated deploy (Deploy P0-1).** Railway currently deploys `main` on push regardless of CI.
   Enable Railway's "wait for CI" / check-suite gating, or move deploys behind a gated workflow.
   Until then the runbook's "CI green first" step is advice, not a gate.
2. **Activate `railway.json` pre-deploy on the API service.** PR #179 put the config in the repo
   and removed migration from the Dockerfile CMD — the API service must actually be set to use
   `preDeployCommand: db:migrate && db:verify`, or deploys will boot without migrating.
3. **Uploads volume (Deploy P1-1).** Item/evidence photos write to the container filesystem
   (`/app/uploads`); without a Railway volume mount (or P7's object-storage move) the first
   redeploy deletes them while DB rows remain.
4. **CodeQL enable (Deploy P1-3).** Code scanning must be enabled in repo Settings; only then can
   `continue-on-error: true` come off `security.yml` and findings start blocking.
5. **Backup restore drill + retention record (Deploy P1-2).** Run one managed-DB restore drill at
   real data volume and record retention + evidence in `docs/PRODUCTION_RUNBOOK.md` §4 (the
   "record it here when set" line is still empty).
6. **GCP key rotation.** The exposed key was removed from `.codex/config.toml`, but it **remains in
   git history** — revoke/rotate it in Google Cloud Console. File cleanup does not undo history.
7. **Staging evidence runs — issues #13 / #15 / #16.** The staging pack is already on main
   (Playwright golden journeys, SSE reconnect harness, upload-boundary suite in
   `docs/staging-evidence-pack.md`). These three issues stay open until a DB-backed staging run
   produces the evidence.
8. **Pre-deploy row audits.** Before the next production deploy: `StockBalance` must be 0 rows /
   dropped (now enforced by `db:verify` from PR #179 — it must run green), and no live rows may sit
   under the phantom `default-company` tenant (defaults removed in PR #180; existing rows need a
   one-time audit).

---

## 4. Honest closing — what "10/10" still requires

The remediation (Phases 1–6) and the Round-2 waves (PRs #178–#182) closed every code-side P0 that
could **invent stock, leak tenants, or deploy blind**. What remains is exactly the distance between
*code-complete* and *production-proven*:

- **CI green on the new mains.** CI verdicts for the wave merges are not readable from the
  automation side; a red run on `main` today would be invisible until someone opens the Actions
  tab. Gate 1 above exists because of this.
- **Staging evidence.** Issues #13/#15/#16 close only when the evidence pack actually runs against
  a DB-backed staging — assets existing is not evidence.
- **The L programmes (P1, P2).** Until operational reads and the control plane live in the
  database, the system is single-replica at heart, however good the code is. These are the two
  items that most separate "strong" from "unbeatable".
- **The M programmes (P3–P8)** executed with their acceptance evidence, not just merged.
- **The platform gates in §3**, which no amount of code can substitute for.

Scores will be re-measured after the next audit round; until the evidence above exists, the honest
rating stays: **a strong ~8.3/10 codebase with production proof still outstanding** — not 10/10.
