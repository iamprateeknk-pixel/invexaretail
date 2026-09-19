# Invexa Operations OS — UI/UX System

## Product direction
Invexa should feel like a modern retail operations command system, not a generic admin template.

The visual system must optimize:
1. speed of action,
2. branch/location awareness,
3. status clarity,
4. exception visibility,
5. scan-first work,
6. low training requirement,
7. high information density without clutter.

## Web information architecture
Persistent shell:
- left navigation with compact mode
- global command/search
- location switcher
- live sync/status
- notifications/exceptions
- user/role menu

Every operations page:
1. command header
2. KPI strip
3. workflow/state strip
4. primary work queue
5. filters/search
6. detail drawer/sheet
7. exception/action rail

Avoid opening many full pages for operational details. Use side sheets for count review, item details, transfer details, picker detail, receiving detail, and import validation.

## Core web components
- OpsPageHeader
- OpsMetricCard
- OpsProgress / OpsProgressRing
- OpsWorkflowStepper
- OpsSyncStatus
- OpsQueueCard
- OpsStatusChip
- OpsEmptyState

Additional components to build as flows land:
- SmartDataTable: sticky columns, density toggle, column chooser, saved filters
- FilterBar: chips, quick filters, date range, branch, user, status
- ExceptionRail: critical issues pinned beside work queue
- ActivityTimeline: immutable event history
- ScanOverlay: scanner success/wrong-item/wrong-lot states
- LotAllocationPreview: FIFO/FEFO allocation visualization
- ReconciliationDiff: book vs physical vs movement timeline
- UserLoadBoard: daily assignment capacity and progress
- CampaignHeatmap: branch x day completion
- CommandPalette actions: start campaign, import sales, create transfer, receive, search item
- ContextDrawer: details without leaving current workflow

## Stock Take Campaign web page
Header:
September Full Stock Take | Branch | ACTIVE | Synced now

KPI cards:
Eligible | Completed | Today assigned | In review | Recount | Overdue | Variance value | Completion %

Workflow:
Setup -> Counting -> Review -> Recount -> Complete

Main body:
- campaign progress and predicted completion
- user workload cards
- today's auto assignments
- remaining priority queue
- verification/recount queue
- exceptions

Admin actions:
Pause | Resume | Adjust daily quota | Reassign absent user | Add newly-stocked items | Close campaign

## Mobile navigation
Bottom nav:
Home | Work | Scan | Stock | More

Home:
- location + sync
- Today's Count
- Pick
- Receive
- Exceptions
- personal progress

Work tabs:
Count | Pick | Receive | Putaway

Scan:
full-screen scanner entry point

Stock:
fast item search + item detail

More:
transfers, reports, profile, sync queue, settings

## Mobile count UX
Do not keep the current form-first design.

Task-first:
- one task card opens one focused work screen
- progress such as 8 / 20 items
- large product identity
- unit/method obvious
- next action is visually dominant

PCS flow:
Scan lot barcode -> scan quantity -> haptic success -> auto-save -> Next

KG flow:
Select item -> large decimal quantity input -> Save & Next
No lot selector.

Always show:
- offline/sync state
- queued actions
- task progress
- Save & Next

Blind users must not see book quantity, expected variance, or lot quantity hints.

## Mobile picking UX
PCS:
- expected item
- scan lot
- large picked count
- remaining quantity
- wrong lot warning
- exception button

KG:
- item + requested KG
- numeric entry
- allocation preview
- confirm

Bottom action:
Save & Next / Finish Pick

## Receiving UX
Transfer card -> Scan transfer/carton -> Receive lines.

For every line:
Expected | Received | Damage | Short | Excess

Use a bottom sheet for exception details/evidence instead of crowding the line.

## Motion and interaction
- skeletons instead of blank waits
- optimistic state transitions
- subtle 150–250 ms transitions
- haptic feedback on mobile scan success/error
- success should move operator forward automatically
- destructive actions require clear reason
- do not animate large decorative elements

## Typography and density
Web:
- dense tables for power users
- 40–44 px row height default
- 32–36 px compact density
- sticky header
- right-align numeric quantities

Mobile:
- 48+ px interactive targets
- 54 px primary CTA
- high contrast count/quantity typography
- one primary action per work state

## Color semantics
Primary emerald = action/success
Blue = active/in progress
Amber = attention/recount/pending
Rose = blocked/error/overdue
Violet = system/intelligence
Neutral slate = secondary metadata

Color can never be the only status signal; always pair with text/icon.

## Dashboard
Dashboard should answer:
- What needs attention now?
- Is stock synchronized?
- Which branch is behind?
- What is moving today?
- What is blocked?
- What changed since last login?

Required modules:
- operational command KPIs
- branch health
- active stock-take progress
- transfer pipeline
- stock import/sync health
- exceptions
- low/expiry stock
- team workload
- recent activity

## Design standard
Every new page must use this hierarchy and reusable kit rather than creating new ad-hoc card styles.
