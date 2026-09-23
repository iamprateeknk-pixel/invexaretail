# Information architecture and navigation map (Week 9)

Source of truth: `web/src/lib/workspace.js`'s `NAVIGATION` constant. This
document is a readable projection of that data plus the fix this week made
to how it's enforced - it is not a parallel spec that can drift from the
code, because the table below is literally `NAVIGATION`'s current content.

## Two separate systems, not one

1. **Retail operations** (`web/src/components/workspace/`) - the
   `NAVIGATION`-driven, role/entitlement-gated module list below. Reached
   whenever the URL hash is not a control-plane route.
2. **SaaS control plane** (`web/src/control-plane/`) - a structurally
   separate app (`ControlPlaneApp.jsx`), gated by `isControlPlaneRoute()`
   in `App.jsx` before the retail `WorkspaceProvider` mounts. Different
   auth model, different navigation, never shares a nav item with retail
   operations. This separation already existed before Week 9; this
   document is the first place it's written down as an explicit IA
   decision rather than left implicit in the routing code.

## Retail operations navigation map

| Group | Section id | Label | Role restriction | Entitlement feature |
|---|---|---|---|---|
| Overview | `dashboard` | Dashboard | none | - |
| Inventory | `inventory` | Items & stock | none | INVENTORY |
| Inventory | `stock-update` | Stock update | ADMIN, ADMIN_USER | INVENTORY |
| Inventory | `expiry` | Lots & expiry | none | INVENTORY |
| Inventory | `catalog` | Tags & custom fields | none | INVENTORY |
| Operations | `counts` | Stock counts | none | INVENTORY |
| Operations | `campaigns` | Auto stock take | ADMIN, ADMIN_USER, BRANCH_MANAGER | INVENTORY |
| Operations | `transfers` | Transfers | none | WMS |
| Operations | `picking` | Picking & receiving | ADMIN, ADMIN_USER, WAREHOUSE_PICKER | WMS |
| Operations | `putaway` | Bins & putaway | ADMIN, ADMIN_USER, WAREHOUSE_PICKER | WMS |
| Operations | `purchase-orders` | Purchase orders | none | PURCHASING |
| Operations | `orders` | Channel orders | ADMIN, ADMIN_USER | OMS |
| Operations | `qc` | Quality control | ADMIN, ADMIN_USER, BRANCH_MANAGER | - |
| Operations | `assets` | Check-in / out | none | - |
| Operations | `jobs` | Jobs & projects | none | - |
| Control | `command-center` | Command center | ADMIN, ADMIN_USER, BRANCH_MANAGER, AUDITOR | - |
| Control | `approvals` | Approvals | ADMIN, ADMIN_USER, BRANCH_MANAGER, AUDITOR | - |
| Control | `reports` | Reports | ADMIN, ADMIN_USER, BRANCH_MANAGER, AUDITOR | - |
| Control | `intelligence` | Intelligence | ADMIN, ADMIN_USER, BRANCH_MANAGER, AUDITOR | ANALYTICS |
| Control | `exceptions` | Exception inbox | none | - |
| Control | `alerts` | Alerts & activity | none | - |
| Control | `integrations` | Integrations | ADMIN only (`adminOnly`) | INTEGRATIONS |
| Control | `connectors` | Marketplace connectors | ADMIN, ADMIN_USER | - |
| Control | `saas` | SaaS & tenants | ADMIN only | - |
| Control | `admin` | Administration | ADMIN, ADMIN_USER | - |

"Role restriction: none" means every retail role (including Store User and
Warehouse Picker) can open it - the module list is not further reduced for
those two roles beyond what's shown. See `docs/web/role-journeys.md` for
which of these each role actually uses day-to-day versus merely can open.

## The enforcement fix (this week)

Before Week 9, the table above was enforced only for *navigation display*
(`lib/workspace.js`'s `visibleNavigationGroups`). A second, separately
maintained table in `Workspace.jsx` (`SECTION_ROLES`) decided *route access*
- and covered only 9 of the 24 sections above, meaning 15 role-restricted
sections (`stock-update`, `campaigns`, `putaway`, `orders` duplicated,
`intelligence`, `integrations`, plus others) had a nav-level hide with no
matching route-level block. `lib/permissions.js`'s `canAccessSection` is now
the single function both the nav and the route guard call, so this table is
authoritative for both "is the link shown" and "does the page render" -
see `lib/permissions.test.js` for the exhaustive role x section proof and
`components/workspace/Workspace.test.jsx` for the DOM-level regression
test.

## Reducing the module list further (not done this week)

The guide's scope item "Reduce navigation to role-relevant modules" is
satisfied structurally (the table above already varies per role via
`roles`/`adminOnly`) rather than by removing modules from the list. A
further reduction - e.g., collapsing "Auto stock take" and "Stock counts"
into one entry for roles that only ever touch one of them, or grouping the
Control section differently per role - is a navigation *design* change that
belongs with the page-rebuild phase's wireframes (subject to the guide's
"Product owner approves role journeys... before page rebuild begins" gate),
not a code change to bundle into this foundation week.
