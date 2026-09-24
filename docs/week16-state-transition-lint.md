# Week 16: the bare-status-write lint rule

## Scope note

Same situation as Weeks 12-15: no guide text available. Closes the other
named "standing follow-up" in AGENTS.md's prohibited patterns section -
rule #7 (state transitions outside the domain policy) had no
machine-checked enforcement since Week 7 named it.

## What changed

`scripts/architecture-lint.mjs` gained `bare-status-write`: flags
`prisma.<model>.update(`/`updateMany(` for `transfer`, `order`,
`purchaseOrder`, `stockCount`, or `returnRequest` whose nearby `data: {...}`
sets `status`, outside the four lifecycle modules
(`transfer-lifecycle.ts`, `po-lifecycle.ts`, `returns-rma.ts`,
`domain-policies.ts`) - same window-based approach as Week 15's
`unscoped-tenant-query`.

## What it found

Six pre-existing violations, all outside the lifecycle modules:

- `lib/orders.ts:190,243,457` - three bare `prisma.order.update({ data: {
  status: ... } })` calls (EXPIRED, a second one, and CANCELLED).
- `lib/persistence.ts:951` - a bare `prisma.transfer.update({ data: {
  status: status as any } })`, the `as any` itself a sign this bypasses the
  lifecycle module's typed `TransferStatus` checking entirely.
- `routes/catalog-procurement.ts:508` - a bare `purchaseOrder.update`.
- `routes/operations-extension.ts:1732` - a bare `returnRequest.update`.

This is a smaller, more contained finding than Week 15's 85 - six call
sites, not the whole god-router surface - but the same category of real
gap AGENTS.md's rule #7 was written to prevent: a status change that never
passes through the transition validation (`DomainError` on an illegal
move, the audit trail) the lifecycle modules provide.

## Not done

The six existing call sites are not fixed this week - each is `lib/orders.ts`
and `lib/persistence.ts`'s own established, pre-domain-policy code path
(Order's terminal-state transitions predate Week 7's `domain-policies.ts`
addition for `Order`), and migrating them safely means confirming they
don't already duplicate validation domain-policies.ts now provides,
which is a real review, not a mechanical fix. Tracked in the lint baseline
(6, non-blocking) via `--update-baseline` - visible in every future lint
run, not hidden. CI now fails on any *new* bare status write for these five
models going forward.
