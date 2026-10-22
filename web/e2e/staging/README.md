# Staging golden journeys (audit R10)

Browser end-to-end journeys that run against a **real** staging deployment —
no mocked API. The specs in `web/e2e/` (accessibility, role journeys, …) mock
every API response (`page.route`) and prove what a person sees; these specs
prove the deployed stack actually works end to end: real login, real stock
reads, real transfer/count/order writes through the canonical posting paths.

> **Status: written, NOT yet executed.** Nothing in this folder has been run
> against a staging environment yet. The first run is itself part of the R10
> evidence; expect to adjust selectors/fixtures once, from real failures,
> rather than treating a first-run red as a surprise. See
> `docs/staging-evidence-pack.md` for how this fits the wider evidence pack.

## Run

From `web/`:

```sh
E2E_WEB_URL=https://<staging-web-host> \
E2E_API_URL=https://<staging-api-host> \
E2E_EMAIL=<staging admin email> \
E2E_PASSWORD=<staging admin password> \
npx playwright test -c playwright.staging.config.js
```

When any `E2E_*` variable is missing, every spec **skips with an explanatory
message** — the default CI run (mocked specs, no staging secrets) stays green.
Do not point these at production: the journeys write real records (a one-unit
order is fulfilled; a count is recorded).

## Fixture requirements (staging data)

- A user with role **ADMIN** (orders and ad-hoc counts are admin-only;
  operational roles need assignments this pack does not create).
- At least **two locations** visible to that user (transfer source + destination).
- At least one location with **stock on hand ≥ 2 units** for some lot
  (journeys discover it via `GET /api/v1/stock/:locationId`; they skip with a
  clear message when no stocked row exists).
- The API must be DB-backed for the fulfil-decrements-stock assertion to be
  meaningful (reservations are DB-only).

Specs clean up what they safely can: the transfer draft is deleted while it
is still editable. Counts and the fulfilled order are real business records
by design — the quantities are one unit / book-quantity, and the order
channel is `E2E-STAGING` and the transfer note says "R10 staging golden
journey", so the trail is easy to find.

## The journeys

| Spec | Journey | Proves |
|---|---|---|
| `01-login.spec.js` | login | Wrong password → 401; right password → token + company-scoped user; browser sign-in works; the stored session never contains a refresh credential |
| `02-stock-check.spec.js` | stock check | `GET /stock/:locationId` rows satisfy `available = onHand − reserved`; the stocked item is findable via item search and its detail names the location |
| `03-transfer.spec.js` | transfer create → confirm | Create → 201 and visible in the list; confirm runs **when** the status is already `READY_FOR_ADMIN`/`PARTIAL` (see the limit below); Transfers section loads |
| `04-count.spec.js` | count flow | Ad-hoc blind count at book quantity is accepted; replaying the same `requestId` is deduped (200 `duplicate: true`) or refused (409) — never double-recorded; Stock counts section loads |
| `05-order-fulfil.spec.js` | order fulfil | Create a one-unit order at the stocked location → fulfil → 200, and the lot's on-hand drops by exactly one |

## Known limit — transfer confirm

A freshly created transfer normally goes through warehouse picking (pick
slips) before an admin can confirm it. This pack does not yet drive the
picker half: it needs a second staging user (`WAREHOUSE_PICKER`) plus the
assignment flow. `03-transfer.spec.js` therefore confirms only when the
status already allows it and otherwise records the actual status as a test
annotation. Extending it with a picker fixture is the first follow-up once
the pack has run green once.
