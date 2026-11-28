# Component catalog (Week 9)

No Storybook or component-catalog tool exists in this repo yet
(`web/package.json` has no such dependency). Building one from scratch is
real, separate infrastructure work; this document is the catalog for now -
one row per shared component, its states/variants, and its accessibility
evidence (a real, run test, not a claim) - and each component lives under
`web/src/components/ui/` where a future Storybook setup would simply point
at the same files.

## Delivered this week

### Stock table and draft preview

Item stock and Studio's Publish tab share the stock table, formula rendering and stock action controls. Studio displays example rows for the selected role, device and location. The preview request resolves the draft under the locked company's session, returns that company's locations, and leaves the published configuration in place. Mobile-width preview removes columns disabled for mobile. The stock table suppresses restricted columns and formulas using restricted values. Preview actions are disabled. The live item table opens details by mouse or keyboard.

**Publish reviewed draft** submits the revision returned with the preview. A stale revision leaves the published configuration in place. PostgreSQL serializes configuration writes per company and checks the saved draft and version history before persisting a release. Publication and rollback each write the new active version and audit in the same transaction. Rollback adds a new version and preserves the previous versions. Studio refreshes its view after a conflicting publish. An operator with a draft based on an older release must reapply its changes to the current version.

**Version history** lists the locked company's published versions with their author, date and active status. An operator can compare an earlier compatible version with the active one, review which configuration areas will change, and enter an audit reason before restoring. Studio asks for a fresh comparison if the active version changes before confirmation. A restore creates a new active version and keeps the draft and prior versions available.

Studio publication and rollback append a company-scoped configuration event in the same PostgreSQL transaction as the release. Operational clients fetch the saved active configuration on invalidation. Web and native clients also refresh configuration when a stream reconnect requires a full read refresh.

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

### Studio release approval

Set `REQUIRE_STUDIO_RELEASE_REVIEW=true` on all API replicas when an independent reviewer is available. The draft preview offers **Request approval** for the exact previewed revision. Another Studio operator can use **Approve and publish**, or the requester can assign an active company administrator. An assigned administrator opens **Studio release review** in the workspace, compares the proposed and published configuration, and approves the exact revision. A Studio operator then refreshes the approval and publishes. The delegated workspace role grants no Studio session or publication access.

The requester and recorded editors cannot approve. For a draft without editor records, the recorded draft creator cannot approve it. Matching email addresses are excluded when assigning company reviewers. Editing the draft invalidates the request, and publication rechecks the assigned administrator's current role. The published version and audit record retain the requester and approver.

The approval mode covers publication of Studio drafts. Emergency restoration still uses the existing version comparison and reason. Keep an API build that enforces review available for rollback once the flag is on. Finish any jointly edited draft from before editor tracking before enabling the flag. Single-operator environments can keep the flag off until independent review is available.

### Scheduled Studio activation

Studio operators can request approval for scheduling even when immediate publishing does not require a review. The Publish tab accepts a local date and time and sends it as a UTC instant for the approved draft revision. Operators can refresh the release status or cancel a pending or blocked schedule. Editing the draft after scheduling invalidates its approval. The worker records the failed check and keeps the live version available.

The database-backed worker checks for due releases every 30 seconds. It rechecks the company, the scheduling operator and any assigned company reviewer before activation. Successful activation writes the version, audit entry and configuration-change event in one transaction. The audit records the scheduling operator and the worker activation time. Start the schedule-aware API and worker together in staging and verify a scheduled release before enabling operator access in production. Keep a schedule-aware rollback build available while there are pending releases.
