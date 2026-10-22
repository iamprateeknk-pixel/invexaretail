# Staging Evidence Pack — R10 / R12 / R13

The audit's three evidence gaps were never "the code is missing" — they were
"nothing has ever been run against a real deployment":

- **R10** — browser E2E existed only with a **mocked** API (`web/e2e/*.spec.js`
  fulfil every `/api/v1/**` request in the browser). No golden journey had
  ever touched a real backend.
- **R12** — the polling/SSE design (25 s heartbeat, cursor replay, durable
  event log) had never been measured under concurrent load or across a
  reconnect.
- **R13** — the upload boundary (one shared multer instance, 15 MB cap) had
  never been probed with hostile files.

This pack adds the test assets for all three. **None of them has been
executed against staging yet.** What is verified today is narrower and stated
plainly per asset below: file placement follows the repo's existing layouts,
the R12 helper units and the R13 suite's expectations are derived from (and
cross-checked against) the current code, and the R12 harness's pure helpers
have unit tests. The first real runs are the evidence; this document says how
to produce and capture them.

## Asset map

| Gap | Asset | Kind | Runs where |
|---|---|---|---|
| R10 | `web/e2e/staging/*.spec.js` (5 journeys) + `web/playwright.staging.config.js` | Playwright vs real API + real web app | Operator machine / CI job with staging secrets |
| R12 | `api/scripts/sse-reconnect-harness.mjs` (`npm run load:sse`) | Node load + reconnect probe | Operator machine against staging API |
| R13 | `api/src/routes/upload-boundary.http.test.ts` (13 tests) | In-process HTTP suite (real routers, memory-mode seed) | Normal API test run — no staging needed |

## R10 — golden journeys

Run (from `web/`):

```sh
E2E_WEB_URL=https://<staging-web> E2E_API_URL=https://<staging-api> \
E2E_EMAIL=<staging admin> E2E_PASSWORD=<staging admin password> \
npx playwright test -c playwright.staging.config.js
```

Without the `E2E_*` variables every spec **skips with a message**, so CI stays
green. Fixtures are discovered from the live API (locations, catalogue, first
stocked lot) — no hardcoded ids, no hardcoded credentials. Journeys: login,
stock check, transfer create → confirm (confirm leg conditional — a fresh
transfer needs the picker flow first; see `web/e2e/staging/README.md`),
count (with requestId replay guard), order create → fulfil with an exact
on-hand decrement assertion.

**Evidence to capture:** the Playwright HTML report + traces/screenshots of
any failure, the run's env (staging commit SHA), and the annotations the
specs emit (fixture used, transfer status). File the report under
`docs/release-evidence/` following the existing convention there.

## R12 — SSE / polling load + reconnect

Run (from `api/`):

```sh
API_URL=https://<staging-api> LOAD_USERS=admin@x:pass[,user2@x:pass2] \
npm run load:sse -- --subscribers 10 --pollers 5 --duration 60 --out summary.json
```

Server facts the harness is built around (`src/routes/events.ts`): heartbeat
every 25 s, `retry: 3000`, streams capped at **5 per user** and 2000 total,
reconnect via `Last-Event-ID` replays missed events from the durable log (or
answers `event: reset` when the cursor is stale — both correct). The harness
spreads subscribers across `LOAD_USERS` respecting the per-user cap, times a
mutation → `item.changed` fan-out, then drops every stream, mutates again,
and records per-stream reconnect hello latency and replay-vs-reset outcome,
while pollers measure the read paths beside it. Output is a JSON summary
(also written to `--out`).

**Proposed thresholds — PROPOSED, not measured.** There is no staging
baseline, so these are starting points to ratify or revise after the first
two runs, not facts:

| Metric | Proposed gate |
|---|---|
| Poller error rate (60 s, 5 pollers) | ≤ 1% (harness enforces via `--max-error-rate`) |
| Probe event latency, p95 (mutation → frame on open streams) | ≤ 2 s |
| Probe delivery | 100% of open streams |
| Reconnect hello latency, p95 | ≤ 3 s |
| Missed-event recovery | replay on ≥ 95% of streams; reset acceptable for the rest |
| Heartbeats | ≥ 1 per stream per 30 s window |

**Evidence to capture:** the JSON summary per run (keep the first two runs —
they set the baseline), staging commit SHA, subscriber/poller counts, and
whether the API ran in durable (DB) mode, since replay behaviour differs
between the in-memory bus and the durable log.

## R13 — upload boundary

`api/src/routes/upload-boundary.http.test.ts` runs in the normal suite
(`npm test` in `api/`) — it boots the real core router in-process like
`events.http.test.ts` and needs no staging. It pins, from the code:

- unauthenticated uploads → 401 (both families);
- photo with no file → 400; text/EXE bytes under image names (incl.
  double extension) → 400 by magic bytes; a > 5 MB PNG → 400 (evidence
  cap bites before multer's 15 MB);
- foreign/missing item photo upload → 404 (ownership is indistinguishable
  from absence, by design); auditor role → 403;
- traversal filename is stored as sanitised data, never a path
  (memory storage + DB rows; no filesystem writes anywhere in the flow);
- import preview: non-admin → 403 before the file is read; extension
  allowlist (.xlsx/.xls/.csv only, double extensions fail) → 400;
  unreadable content → 400; a 16 MB file → rejected, no batch staged.

**Evidence to capture:** the suite's CI output. One expectation is
deliberately loose — the oversize status code — because there is **no
MulterError handler in `src/index.ts`** (verified by read): Express's
default error handler answers, expected 500 rather than a clean 413/400.
Pin the exact code in the test after the first run, and treat adding a
multer error handler as a small follow-up fix (it is a code change, so it
is deliberately NOT part of this test-only pack).

## Observations recorded while building this pack (not fixed here)

1. **Oversize uploads get an unhandled 500** (no MulterError middleware).
   Cosmetic for security, noisy for clients and logs — small follow-up.
2. **The shared multer instance has no `fileFilter`** — all type safety
   rests on per-endpoint validation. Today both families validate (photos
   by content, imports by extension + parser), but any future upload
   endpoint that forgets to validate inherits a silent hole. A defence-in-
   depth filter on the shared instance is worth considering.
3. **Photo/evidence persistence requires a database** — in memory mode a
   fully valid photo upload ends in 503 by design. Staging for R10/R12
   must therefore be DB-backed for the evidence to mean anything.
