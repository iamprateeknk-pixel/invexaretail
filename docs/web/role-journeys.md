# Role journey matrix (Week 9)

Grounded in what already exists - `web/src/lib/workspace.js`'s `NAVIGATION`/
`PAGE_META` (the real, live module list and per-role visibility rules) and
the `Role` union shared with the API (`api/src/lib/inventory.ts`). This is
not a new taxonomy invented for this document; it is the existing app's own
navigation rules, made explicit as journeys so the "role-relevant
navigation" scope item has a source to design against.

## Admin / Admin User

- **Top tasks**: configure company/locations/users, review the full
  operational picture, approve exceptions, manage integrations and SaaS
  entitlements.
- **Home destination**: Command Center. Its first actions link to ERP imports,
  approvals and exceptions where the company and role permit them.
- **Daily queue**: `command-center` (what needs attention now across
  branches), `approvals` (pending count reviews), `exceptions`
  (damage/shortage/pick disposition), `alerts`.
- **Exception paths**: `exceptions` inbox for physical discrepancies;
  `approvals` for policy-gated decisions (count variance, PO approval);
  `intelligence` for reorder-anomaly investigation.
- **Full navigation access**: every `NAVIGATION` item (ADMIN is allowed
  everywhere - no `roles` restriction excludes it, and `adminOnly` items
  like `integrations` are ADMIN-exclusive rather than ADMIN-inclusive of
  everyone else).
- **ADMIN vs ADMIN_USER distinction**: `saas` (SaaS & tenants) and
  `integrations` are `adminOnly`/`ADMIN`-only - ADMIN_USER shares every
  other Admin capability but not platform-level SaaS/integration control.

## Branch Manager

- **Top tasks**: run day-to-day store/branch operations - stock counts,
  transfers, QC, reviewing reports for their branch.
- **Home destination**: Stock counts, with approvals and transfers as fallbacks.
- **Daily queue**: `counts` (assign/review blind counts), `transfers`
  (requests awaiting dispatch/receipt), `command-center`, `approvals`,
  `reports`.
- **Exception paths**: `exceptions` inbox; `qc` for receiving inspection
  failures; `approvals` for count-variance sign-off.
- **Excluded modules**: `stock-update` (bulk manual/import stock
  correction - Admin-only), `orders`, `connectors`, `saas`, `admin`,
  `integrations` (all Admin/Admin-User-only per `NAVIGATION`).

## Store User

- **Top tasks**: request transfers into their store, run stock counts,
  keep local inventory records current within their assigned location(s).
- **Home destination**: Assigned stock counts, with transfers and item search as fallbacks.
- **Daily queue**: `counts` (their assigned tasks - `count-assignments/mine`
  server-side), `transfers` (their store's requests), `inventory`.
- **Exception paths**: `exceptions` inbox (visible to every role per
  `NAVIGATION` - no `roles` restriction on that item); cannot self-approve
  a count variance (`approvals` is Branch-Manager-and-up).
- **Excluded modules**: `stock-update`, `campaigns`, `picking`, `putaway`,
  `purchase-orders` action rights (list is visible, badge included, but see
  page-level entitlement checks - out of this week's route-level scope),
  `orders`, `qc`, `command-center`, `approvals`, `reports`, `intelligence`,
  `connectors`, `saas`, `admin`, `integrations`.
- **This is the role most restricted by `NAVIGATION`** - a large share of
  the 17 sections that had no `SECTION_ROLES` route guard before this week
  (`putaway`, `stock-update`, `campaigns`, `qc`, `picking`, `command-center`
  duplicated, `intelligence`, `integrations`) are ones a Store User account
  could previously reach directly by URL despite never seeing them in the
  nav. Week 9's `lib/permissions.js` closes this for all of them at once.

## Warehouse Picker

- **Top tasks**: pick and receive transfers, manage bins/putaway, action
  pick-wave assignments.
- **Home destination**: Picking & receiving, with bins & putaway and transfers as fallbacks.
- **Daily queue**: `picking` (pick tasks and destination receiving),
  `putaway` (received stock awaiting shelving), `transfers` (visibility
  into what's inbound/outbound).
- **Exception paths**: `exceptions` inbox for pick discrepancies (wrong
  item, shortage, damage found during pick/putaway).
- **Excluded modules**: everything Admin/Branch-Manager/reporting-oriented -
  `admin`, `reports`, `approvals`, `command-center`, `intelligence`,
  `orders`, `qc`, `connectors`, `saas`, `integrations`, `campaigns`,
  `stock-update`.

## Auditor

- **Top tasks**: read-only oversight - review command center, approvals
  history, reports, without operational write access to counts/transfers.
- **Home destination**: Reports, with Command Center as a fallback.
- **Daily queue**: `command-center`, `approvals`, `reports`,
  `intelligence`.
- **Exception paths**: views `exceptions` inbox for audit trail purposes;
  does not action counts or transfers directly (no `roles` entry grants
  Auditor `counts`/`transfers` write actions at the page level - out of
  this week's scope to verify page-by-page, flagged as a page-rebuild-phase
  check).
- **Excluded modules**: everything operational-write (`inventory` write
  paths, `stock-update`, `picking`, `putaway`, `transfers` creation,
  `qc`, `orders`, `connectors`, `saas`, `admin`, `integrations`,
  `campaigns`).

## SaaS control plane (separate persona, not a retail `Role`)

Handled entirely outside the retail-operations `NAVIGATION`/`Role` system:
`web/src/control-plane/ControlPlaneApp.jsx`, gated by
`isControlPlaneRoute()` in `App.jsx` before the retail `WorkspaceProvider`
ever mounts. This is Week 9's "separate SaaS control-plane navigation from
retail operations" requirement already true structurally (two different
React trees, two different auth models) - not something this week needed
to build, only to document as already satisfied. The `saas` NAVIGATION item
inside retail operations is a bridge *from* retail ops *into* a
tenant-provisioning view, not the control plane itself, and stays
ADMIN-only.

## Starting a session

The workspace loads the company's navigation profile independently of stock,
catalogue and count data. Automatic landing selects the first available queue
using the route permission check. The shared Dashboard is the fallback when the
navigation profile is unavailable. Explicit links retain their destination and
its permission check. Signing out clears an automatically chosen route that is
still open so the next account can start from its own queue.

## Remaining work

- **Page-level entitlement checks** - e.g., whether a
  Store User can see the "create PO" button in `purchase-orders` versus
  only view it. This week's fix is at the route/module boundary
  (`Workspace.jsx`); in-page action-level permission gates are numerous and
  page-specific, and are the page-rebuild phase's job per the guide's own
  "keep existing business screens operational... do not redesign pages
  independently" instruction.
- Director, Purchaser and Warehouse Manager still need separate operational
  roles and authorization. These landings use the six existing API roles.
