# ADR-005: name the bounded contexts; the two mega-files freeze in place until they can be split along those lines

## Context
The API is 34 Express router modules mounted in `src/index.ts` under
`/api/v1`, with no explicit bounded-context boundary above "one file per
router." Most files are reasonably sized and single-purpose
(`transfer-logistics.ts`, `catalog-procurement.ts`, `events.ts`). Two are
not: `routes/core.ts` is 3,881 lines and `routes/operations-extension.ts` is
2,498 lines, each spanning several of the contexts below in one file. Both
already appear as direct `StockLedger` write sites in ADR-001 - the file
size and the ownership problem are the same symptom.

## Decision
Name seven bounded contexts and assign every existing router to exactly one,
so "which context does this route belong to" has one answer even before the
mega-files are split:

| Context | Representative routers today |
|---|---|
| Identity | `enterprise-auth.ts`, `enterprise-management.ts` (users, roles, permissions) |
| Catalog | `item-master.ts`, parts of `core.ts` (items, lots) |
| Inventory | `foundation.ts` (StockMovement/StockBalance), parts of `core.ts` (StockLedger, counts) |
| Warehouse | `transfer-logistics.ts`, parts of `operations-extension.ts` (bins, putaway, picking) |
| Procurement | `catalog-procurement.ts` (suppliers, purchase orders, receiving) |
| Orders | parts of `operations-extension.ts` (OMS, fulfillment, returns) |
| Reporting | `command-center.ts`, `enterprise-analytics.ts` |

No new business domain may be added to `core.ts` or `operations-extension.ts`
going forward - a new route belongs to one of the seven contexts above and
gets its own router file named for that context, mounted alongside the
existing 34. Splitting the two existing mega-files along these same
boundaries is out of scope for this week (explicitly deferred - "do not
perform the large refactor... yet") and is scheduled opportunistically: each
time an unrelated change touches a piece of `core.ts` or
`operations-extension.ts`, that piece is a candidate to extract into its
named context's router instead of growing further in place.

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
- Every future PR touching either mega-file states, in its description,
  which named context the change belongs to - the first step toward the
  eventual split is making the boundary visible in review, before it is
  visible in the file tree.
