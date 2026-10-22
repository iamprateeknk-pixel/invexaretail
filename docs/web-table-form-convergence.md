# Web table/form convergence — census + policy (Phase 4B)

Status: **policy adopted** (Phase 4, step 31). Execution is opportunistic —
pages and forms migrate when they are touched for other work, not in a
flag-day sweep. The full usage census described below is the first
executing step of Phase 4B; the sampled evidence in this document is what
the policy rests on today.

## Why this exists

The web app grew **two live list stacks** and **inconsistently adopted
form tooling**. Both list stacks render through the same shadcn
primitives (`web/src/components/ui/table.jsx`), so users see one table —
but state, sorting, and pagination semantics differ per page, and every
new page has to pick a side. Phase 4 (god-file decomposition + admin
unification) deliberately did not bundle this migration: a forced
migration of every page and form would be larger than the god-file work
itself and mostly invisible to users.

## The two table stacks (verified by direct reads)

| | Stack A — table-state | Stack B — pagination |
|---|---|---|
| Pieces | `web/src/lib/table-state.js` (`DEFAULT_TABLE_STATE`, hidden-column helpers), `web/src/hooks/useTableView.js`, `web/src/components/ui/table-toolbar.jsx` | `web/src/lib/pagination.js` (`paginateRows` → `{rows, page, pageSize, pageCount, total, from, to}`), `web/src/components/TablePagination.jsx` |
| Test cover | `table-state.test.js`, `table-toolbar.test.jsx`, `useTableView.test.jsx` | `pagination.test.js` |
| Sampled users | `CountsPage.jsx`, `TransfersPage.jsx` (search / sort / hidden columns / saved views) | `InventoryPage.jsx` (local page state + `paginateRows` + `<TablePagination>`) |

## Forms (verified sample + package evidence)

- `react-hook-form` is a web dependency and the shadcn RHF wrapper exists
  (`web/src/components/ui/form.jsx` — `Form`/`FormField` on RHF's
  `Controller`/`FormProvider`).
- **No schema validator** (no zod or equivalent) is in the dependency
  list; validation today is hand-rolled in lib modules.
- Flagship forms bypass the tooling: `ItemMasterPanel.jsx` uses
  `useState` + hand-rolled `Field`/`Section` components + the
  `lib/item-master.js` converters (`itemToForm`/`formToPayload`).

## Policy

1. **Canonical list stack = Stack A** (`table-state` + `useTableView` +
   `table-toolbar`) — it is the superset (search, sort, column
   visibility, saved views) and the better-tested one.
2. `paginateRows` **survives as the slicing primitive underneath**
   Stack A. `TablePagination.jsx` is adapted to render from the
   `useTableView` view model, so Stack-B pages keep their footer UI
   while their state converges.
3. **New pages use Stack A.** Existing Stack-B pages migrate
   opportunistically — when a page is edited for any other reason — plus
   a dedicated sweep only for pages whose pagination is visibly
   divergent (decided from the census).
4. **Forms:** RHF + `ui/form.jsx` is the standard for new forms and for
   any form already being edited. Existing manual forms migrate
   opportunistically, one per PR, keeping their lib converters
   (`itemToForm`/`formToPayload`) as the payload boundary.
5. **Do not introduce zod (or any schema validator) under this policy.**
   Schema validation changes the error surface everywhere it lands; if
   wanted, it is its own decision with its own PR.

## The census (first executing step of Phase 4B)

A full usage census was **not** performed when this policy was written —
the samples above prove both stacks are live in major pages; they do not
prove proportions. Before any dedicated sweep, grep every workspace page
and panel for:

- `useTableView` / `table-state` imports → Stack A
- `paginateRows` / `TablePagination` imports → Stack B
- neither (hand-rolled page state) → third bucket, named explicitly

Publish the counts in the PR that runs it, and update this document with
the results. Pages in the third bucket migrate first — they have neither
stack's tests behind them.
