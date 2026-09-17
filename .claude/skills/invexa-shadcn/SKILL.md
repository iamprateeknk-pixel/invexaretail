---
name: invexa-shadcn
description: Build or refine Invexa Retail web interfaces with the existing shadcn/ui foundation and Invexa design system. Use for dashboard, navigation, inventory, counts, transfers, procurement, reports, alerts, administration, responsive UI, or component work in web/.
---

# Invexa shadcn UI

Work inside `web/` and inspect `web/components.json`, `web/src/index.css`, existing UI components, routes, roles, and API contracts before editing. When the shadcn CLI or MCP server is available, use `shadcn info --json`, registry search, and component documentation to confirm project-specific APIs before adding components.

## Product structure

- Keep Dashboard as an overview of work, risk, and trends.
- Put operational actions in dedicated modules reached through persistent navigation.
- Make operational KPI cards navigate to a filtered queue.
- Open row context in a right-side Sheet or dedicated deep-linked page so list context is preserved.
- Use shared DataTable, form, status, empty, loading, error, and permission patterns.

## Business invariants

Preserve blind stock counts, assignment and approval/rejection, transfer request through picking/dispatch/receiving, partial and damaged receiving, location scope, lot/expiry data, roles and permissions, audit events, barcode scanning, and offline replay safety. UI authorization does not replace backend permission checks. Do not make destructive database migrations without explicit approval.

## Invexa design system

- Use the emerald primary and slate neutral OKLCH tokens in `web/src/index.css`.
- Use compact, readable ERP density; clear hierarchy; 8-12px radii; subtle borders; restrained shadows; and whitespace instead of decoration.
- Use Lucide icons from the configured icon library, never emoji as primary interface icons.
- Use semantic token colors for success, warning, destructive, muted, border, and focus states.
- Support light and dark themes, keyboard navigation, visible focus, labels, adequate contrast, and non-color-only statuses.
- Desktop uses a persistent sidebar. Tablet and mobile use a Sheet navigation drawer. Scanning, counting, picking, and receiving must remain touch-friendly.

## Component rules

Reuse `web/src/components/ui` before adding a component. Prefer Card for KPIs, Table or DataTable for queues, Sheet for contextual detail, Dialog for focused edits or confirmations, Tabs for queue views, Badge for state, Select or Command for structured choices, and Sonner for mutation feedback. Add new registry components with the shadcn CLI rather than hand-copying them when registry access is available.

Keep Hostinger deployment compatible: the web app is a Vite static build on shared hosting and uses hash navigation unless an Apache fallback is deliberately configured. The existing API and Hostinger MySQL data contracts remain authoritative.

Before finishing, run `npm run build` and `npm run lint` in `web/`, verify desktop/mobile overflow and focus behavior, and report any pre-existing warnings separately from new failures.
