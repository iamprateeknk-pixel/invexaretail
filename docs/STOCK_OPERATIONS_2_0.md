# Invexa Stock Operations 2.0

## Goal
Replace one-off stock-count assignments with a branch-scoped Stock Take Campaign engine and unify counting, picking, transfer, receiving, item master, ERP movement imports, dashboards, and near-real-time sync.

## Current gaps confirmed in main
- CountAssignment is one item -> one user. Mobile groups one admin batch, but there is no campaign/month lifecycle.
- Mobile CountScreen requires selecting a lot for any item that has lots. This is wrong for loose KG items that are physically counted at item level.
- Current assignment flow does not automatically schedule unfinished items each day or balance workload across selected branch users.
- Daily sales/purchase import already preserves document/time context, but stock-take snapshots are not campaign-aware.
- Web transfer/receive backend is much richer than the Flutter pick/transfer UI, so mobile presents a basic workflow despite stronger server capability.
- Manual refresh remains visible in primary mobile flows.

## Target operating model

### 1. Stock Take Campaign
Admin creates one campaign:
- branch/location
- campaign name (example: September 2026 Full Count)
- start/end date
- selected users from that branch
- daily items per user
- strategy: oldest-never-counted first, then oldest-counted, optional ABC/risk priority
- zero-stock policy
- blind count mode
- tolerance/recount rules

States:
DRAFT -> ACTIVE -> COUNTING -> IN_REVIEW -> COMPLETED
with PAUSED and CANCELLED.

Admin does not assign daily items manually.

### 2. Daily Auto Assignment
At the branch-local day boundary (and also idempotently when first user opens the app):
1. Read current positive stock at the campaign branch.
2. Exclude items completed in this campaign.
3. Exclude items already assigned today unless reassignment is required.
4. Prioritize never-counted/oldest-counted plus risk/ABC.
5. Distribute up to dailyItemsPerUser across selected active users.
6. Persist a DailyCountBatch and DailyCountTask rows.
7. Carry unfinished tasks forward without duplication.
8. When all campaign stock items are completed and reviewed, finish campaign.

Campaign inventory is dynamic: newly stocked items can join the remaining queue according to policy.

### 3. PCS vs KG counting
Item Master must carry:
- baseUnit: PCS | KG
- countMethod: LOT_SCAN | ITEM_WEIGHT
- pickMethod: LOT_SCAN | ITEM_QTY_FIFO
- decimalPrecision
- barcode policy

PCS:
- lot code is barcode
- scan lot
- repeated scans increment quantity
- count remains lot-specific

Loose KG:
- user searches/selects item; no lot selection required
- enter total physical KG with decimals
- server allocates physical total to current lots using FIFO/FEFO policy for reconciliation

Example book lots 2kg + 2kg + 2kg, physical item count 5kg:
- reconciliation should preserve total physical = 5kg
- allocation result can be 2kg + 2kg + 1kg (FIFO/FEFO)
- variance report shows -1kg on the residual lot, not three fake independent manual counts
- allocation must be deterministic and auditable

Never create a negative lot allocation. If physical exceeds lot book total, post excess to an explicit adjustment/unattributed reconciliation bucket pending review.

### 4. Count state machine
Daily task:
ASSIGNED -> IN_PROGRESS -> SUBMITTED -> IN_REVIEW -> APPROVED
or RECOUNT -> reassigned task.

Campaign dashboard:
- eligible items
- counted
- pending
- assigned today
- submitted today
- in review
- recount
- completion %
- users progress
- aged/overdue tasks
- variance value and units

### 5. Stock snapshot accuracy
Every count submission stores:
- startedAt
- countedAt
- submittedAt
- snapshotAt
- book quantity at snapshot
- last movement timestamp included

Sales/purchase imports keep:
- invoice number
- invoice date
- transaction timestamp
- branch
- item
- lot where supplied
- quantity
- import batch

Reconciliation engine determines book stock at the physical count timestamp, so a 2 PM count is compared against movements up to 2 PM, not against end-of-day stock imported later.

Late-arriving ERP movements must trigger a recomputation flag for affected counts rather than silently changing history.

### 6. Purchase & sales import
Support one full-day batch upload.
- Sales: branch-wise, bill date + bill time + invoice number.
- Sales return: adds back to same branch.
- Purchase: H.O. Basni receipt with source timestamp.
- Idempotency by source document + line fingerprint.
- Preview, validation, duplicate detection and reversal remain mandatory.
- Add import reconciliation monitor: received rows, duplicates, unmatched items/lots/branches, affected historical counts.

### 7. Picking / packing
For transfer/order picking:
PCS:
- picker scans lot barcode
- validate requested item + lot
- increment picked qty
- block wrong lot/item with haptic/error
- allow reasoned exception

KG:
- picker selects item
- enters total KG
- server auto-allocates lots FIFO/FEFO
- show generated allocation before confirm
- picker should not manually split across lots

Pick task states:
READY -> IN_PROGRESS -> PICKED -> PACKED -> DISPATCHED

Add carton/pack session, scan verification, shortage/damage/no-stock reason, evidence, picker productivity and resume support.

### 8. Transfer receiving
REQUESTED -> APPROVED -> PICKING -> PICKED -> PACKED -> DISPATCHED -> IN_TRANSIT -> RECEIVING -> RECEIVED
with PARTIAL, EXCEPTION and CANCELLED paths.

Receiving:
- scan transfer/carton
- PCS lot scan
- KG manual received qty with expected FIFO allocation shown
- received/damaged/short/excess
- evidence
- exception inbox
- exactly-once stock posting

### 9. Item Master
One canonical screen with:
- name/code
- category/brand
- base unit and precision
- barcode/lot policy
- count/pick method
- FIFO vs FEFO
- min/max/reorder
- active locations
- image
- supplier refs
- tax/HSN fields where used
- aliases used by ERP imports

### 10. Mobile UX
Use a workflow-first shell:
Home | Work | Scan | Stock | More

Home:
- Today's Count card
- Pick tasks
- Receive tasks
- sync state
- exceptions
- personal progress

Count screen:
- one task at a time
- large item identity/photo
- progress bar
- PCS: scanner-first
- KG: large decimal keypad
- Save & Next
- offline queue indicator
- no admin/book-stock clutter for blind users

Use Sortly's good idea of a clear Workflows surface, stock-count stages, scan-to-count and cloud sync, but keep Invexa's deeper branch/lot/FIFO and ERP-time reconciliation.

### 11. Near-real-time sync
Replace refresh-first UX with:
- server events (WebSocket/SSE)
- query cache invalidation after every mutation
- optimistic local updates
- mobile local outbox for offline actions
- reconnect auto-sync
- stale-data badge if last sync exceeds threshold
- background refresh on app resume

Manual pull-to-refresh stays as fallback, not primary sync.

### 12. Implementation order
P0: schema + campaign engine + unit/count/pick metadata + FIFO allocator
P1: campaign APIs + scheduler/idempotent daily allocator + historical snapshot reconciliation
P2: web Stock Take Campaign UI + advanced dashboard
P3: Flutter workflow shell + count UX
P4: picking/packing mobile + FIFO KG allocation
P5: transfer dispatch/receive mobile state machine
P6: item master
P7: real-time event sync + offline conflict handling
P8: analytics, productivity, variance intelligence

## Non-negotiable acceptance tests
- Assignment candidates only come from stock belonging to the selected branch/location.
- An ACTIVE campaign can run a whole month without admin assigning individual items every day.
- No item is duplicated across active daily tasks unless explicitly in RECOUNT.
- User absence/reassignment does not lose campaign coverage.
- KG count accepts decimals and never forces a lot scan.
- KG physical quantity reconciles deterministically across lots.
- PCS requires valid item/lot barcode where configured.
- Picking follows the same PCS/KG rules as counting.
- Daily purchase/sales batch imports are idempotent and timestamp-aware.
- Counts remain historically explainable when ERP data arrives later.
- Every stock posting is exactly-once and auditable.
- Mobile changes appear automatically after successful sync/event without requiring routine manual refresh.
