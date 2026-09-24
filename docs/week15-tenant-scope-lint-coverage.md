# Week 15: widening the unscoped-tenant-query lint rule

## Scope note

Same situation as Weeks 12-14: no guide text for Week 15 is available.
This week is a small, mechanical, high-signal one: widen
`architecture-lint.mjs`'s `unscoped-tenant-query` rule past its original
Item-only pilot, which AGENTS.md's prohibited-patterns section had named as
a "standing follow-up" since Week 4/10.

## What changed

`scripts/architecture-lint.mjs`'s rule went from checking only
`prisma.item.*` to a curated list, `TENANT_SCOPED_MODELS`: `item`,
`transfer`, `purchaseOrder`, `order`, `stockCount`, `returnRequest`,
`exceptionCase`, `importBatch`, `importRow`, `expiryAlert` - the models
this repo's own weeks of work have actually reasoned about a tenant-scoping
story for (see AGENTS.md's Tenant scope row and each model's module-
ownership row). Not the full `OPERATIONAL_TENANT_TABLES` list (37 models) -
some of those (`Bin`, `Job`, `AuditLog`, etc.) haven't been reviewed for
whether `companyId`/`tenantId` is even the right nearby signal, and a
naive multi-line-window check gets noisier the more models it covers.

## What it found

**85 new violations**, almost entirely in `routes/operations-extension.ts`
(the frozen god-router, ADR-005) - many of them a real, serious pattern:
`prisma.order.findUnique({ where: { id: req.params.id } })` and similar,
with **no tenant check anywhere nearby**. An id is looked up and trusted
without ever confirming it belongs to the caller's company. This is not a
false positive to explain away - it is the same class of gap Week 12 found
and fixed for `ExceptionCase`, just far more widespread than one model.

This week does **not** fix those 85 call sites. That is a multi-week
migration in its own right (route-by-route review of `operations-
extension.ts`, the exact kind of god-router extraction work Weeks 8/10/11
have been doing one bounded slice at a time) and forcing it into one week
would mean either rushing it unsafely or silently narrowing scope. Per
this repo's own established pattern (`float-money`'s 17 pre-existing
violations, `direct-stock-write`'s original ~8), the honest move is:
**make the gap visible and tracked, not silently fixed by fiat.**

`node scripts/architecture-lint.mjs --update-baseline` was run, so the
total baseline for this rule is now 101 (16 original Item findings + 85
newly surfaced). All 101 are `existing (baseline, non-blocking)` - CI still
only fails on a genuinely *new* unscoped query going forward, for any of
the ten now-covered models, not on this pre-existing surface.

## Not done

- The 85 newly-surfaced `operations-extension.ts` call sites are not
  fixed. They are now visible in every future lint run instead of hidden
  inside an Item-only rule - the actual remediation is future work, most
  naturally alongside whichever week next extracts a slice of
  `operations-extension.ts` into its own router (see
  `docs/route-ownership-matrix.md`).
- The remaining `OPERATIONAL_TENANT_TABLES` models not in
  `TENANT_SCOPED_MODELS` are still unchecked by this rule.
