# ADR-005: Routers stay domain-grouped Express routers, but the two mega-files freeze in place

## Context
The API is 34 Express router modules mounted in `src/index.ts` under
`/api/v1`. Most are reasonably sized and single-purpose
(`transfer-logistics.ts`, `catalog-procurement.ts`, `events.ts`). Two are
not: `routes/core.ts` is 3,881 lines and `routes/operations-extension.ts` is
2,498 lines, each covering multiple bounded contexts (core.ts alone spans
inventory, transfers, counts, imports, audit). Both already appear as direct
`StockLedger` write sites in ADR-001 - the file size and the ownership
problem are the same symptom.

## Decision
No new business domain may be added to `core.ts` or `operations-extension.ts`.
New routes get their own router file, named after the bounded context, and
are mounted alongside the existing 34. Splitting the two existing mega-files
is out of scope for this week (explicitly deferred - "do not perform the
large refactor... yet") and is scheduled opportunistically as each bounded
context inside them gets touched for unrelated feature work.

## Alternatives considered
- **Split both files now.** Rejected for this week: the guide's own
  instruction is architecture decisions only, no large refactor, and a
  3,800-line file split without dedicated review time risks silent route or
  middleware-ordering regressions (several routes rely on middleware applied
  in `index.ts` in a specific order).
- **Introduce a framework-level module boundary (NestJS-style modules).**
  Rejected: would mean rewriting all 34 routers' registration, disproportionate
  to the actual problem (two oversized files, not a systemic pattern).

## Migration impact
None - no files moved in this change.

## Compatibility
No API change.

## Rollback
N/A - no code changes shipped with this ADR.

## Consequences (measurable)
- Tracked as a to-do, not lint-enforced this week: `core.ts` and
  `operations-extension.ts` line counts are recorded here (3,881 / 2,498) as
  the baseline to shrink over time. A future lint rule can fail CI if either
  file grows past its recorded baseline once the split work begins.
