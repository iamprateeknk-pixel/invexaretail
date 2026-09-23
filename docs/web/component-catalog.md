# Component catalog (Week 9)

No Storybook or component-catalog tool exists in this repo yet
(`web/package.json` has no such dependency). Building one from scratch is
real, separate infrastructure work; this document is the catalog for now -
one row per shared component, its states/variants, and its accessibility
evidence (a real, run test, not a claim) - and each component lives under
`web/src/components/ui/` where a future Storybook setup would simply point
at the same files.

## Delivered this week

### Feedback states (`web/src/components/ui/feedback-states.jsx`)

| Component | Variants | Used by | Accessibility evidence |
|---|---|---|---|
| `LoadingState` | `label` (custom message) | not yet adopted outside its own test - see backlog | `role="status"` announces to assistive tech; `feedback-states.test.jsx` asserts it. |
| `EmptyState` | `title`, `description`, `action` (optional) | `Workspace.jsx` (module with no page registered) | Heading is a real `<h3>` (`getByRole('heading')`); an action renders as a real `<button>` (native keyboard/focus semantics, not a styled `<div onClick>`). |
| `ErrorState` | `title`, `description`, `onRetry` (optional) | not yet adopted outside its own test - see backlog | Retry button is focusable (`element.focus()` + `document.activeElement` assertion) and its click handler fires via `fireEvent.click`. |
| `PermissionDeniedState` | `onReturn`, `returnLabel` | `Workspace.jsx` (role/entitlement-denied route) | Distinct accessible text ("Access restricted") from every other state, so a screen reader user does not confuse it with a generic error; `Workspace.test.jsx` proves this via real role-denial scenarios (Store User -> `putaway`, entitlement-hidden `orders`). |
| `OfflineState` | `onRetry` | not yet adopted outside its own test - see backlog | Distinct accessible text ("You're offline") and a distinctly labeled retry action ("Retry connection" vs `ErrorState`'s "Try again"), so the two are not confusable by label alone. |

All five share one `StateCard` internal layout (icon, heading, description,
action) - the guide's "no new one-off table or form primitive" requirement
applied to feedback UI: there is one shape, not five ad hoc card layouts.

**Desktop/tablet/mobile**: all five are built with the same responsive
card as `Card`/`CardContent` (`web/src/components/ui/card.jsx`), which is
already fluid-width and used across every breakpoint in the app - no
separate mobile variant needed for a centered message card.

### Route/permission gate (`web/src/lib/permissions.js`)

Not a visual component, but the accessibility-adjacent guarantee this week
adds: a role- or entitlement-denied route now reliably renders
`PermissionDeniedState` instead of a partially-broken page (missing data,
undefined-prop crashes) or, worse, a fully rendered page a role should
never have reached. Evidence: `permissions.test.js` (exhaustive role x
section matrix) and `Workspace.test.jsx` (DOM-level proof for two concrete
regressions the old `SECTION_ROLES` table missed).

### Global focus style (`web/src/index.css`)

Not a component, but a baseline every component above (and every future
one) relies on instead of its own focus treatment - see
`docs/web/token-specification.md`'s Focus section. Evidence: every
`.focus()` assertion across `feedback-states.test.jsx` and
`Workspace.test.jsx` exercises a real, focusable, native element relying on
this rule.

## Test toolchain (new infrastructure, not a component, but required to produce the evidence above)

Before this week, no test in this repo had ever imported a real `.jsx`
component file - the existing `npm test` (`node --test`) only covered
plain-`.js` hooks/lib modules. `web/test/jsx-loader.mjs` +
`web/test/register.mjs` is a minimal Node.js ESM loader (via esbuild) that
lets `node --test` import and render real `.jsx`/`.tsx` files with
`@testing-library/react` + `jsdom`, resolving the app's `@/` alias and
Vite's extensionless imports the same way Vite itself does. Run via
`npm run test:components` (or `npm run test:all` for both suites). This is
the mechanism, not a Storybook replacement - it proves components work in
isolation with real accessibility assertions; it does not provide the
interactive visual browsing a real component catalog tool would.

## Backlog (named, not silently dropped)

- **`SmartDataTable`, `FilterBar`, `Drawer`, `Stepper/Wizard`, `FormField`,
  `AppShell`** - the guide's full shared-component list. Not built this
  week: each requires auditing how the ~23 existing pages currently
  implement tables/filters/dialogs/multi-step forms/field validation
  (`web/src/components/TablePagination.jsx` standing alone as a signal that
  pagination has already been reinvented at least once) so the shared
  version actually replaces those patterns rather than becoming a ninth
  one-off alongside them. That audit and the resulting components are real,
  separate follow-up work - attempting all six in the time remaining this
  week would have meant shipping them unaudited and untested, which is
  worse than not shipping them.
- **A real component-catalog tool (Storybook or equivalent)** - this
  markdown file is a stand-in. Worth doing once there are enough components
  to make browsing them interactively valuable (after the backlog above
  lands), not before.
- **Desktop/tablet/mobile variants as distinct, designed states** - the
  five delivered components are responsive by inheriting `Card`'s
  fluid layout, not because each was explicitly designed and tested at
  three breakpoints. A real `SmartDataTable`, in particular, needs an
  actual mobile-card-view variant (tables don't just "reflow"); that design
  work belongs with building it, not retrofitted after.
- **Contrast measurement** - the "Mandatory verification" list asks for
  contrast checks. This week's tokens (existing OKLCH color set) were not
  re-audited for WCAG contrast ratios; doing so honestly requires computing
  actual contrast ratios for every foreground/background pairing, which is
  real, separate work, not something to assert without having measured it.
  Flagged for the accessibility-baseline gate the guide names before page
  rebuild begins.
