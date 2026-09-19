import type { CountAssignmentRecord, CountRecord, TransferRecord } from './repository.js';

// Blueprint v4 §29 Operations Command Center. One question per section:
//   What needs attention now?  Is inventory synchronized?  Which branch is behind?
//   What is moving?  What is blocked?  How is the team performing?  What changed?
// Everything here is derived from data the API already holds; the route feeds it
// (and adds the parts that only exist in the database).

export type Severity = 'CRITICAL' | 'WARNING' | 'INFO';

export type CommandCenterInput = {
  now: Date;
  locations: Array<{ id: string; name: string; type?: string }>;
  counts: CountRecord[];
  assignments: CountAssignmentRecord[];
  transfers: TransferRecord[];
  checkpoints: Array<{ locationId: string; sourceType: 'SALES' | 'PURCHASE'; syncedThroughAt: string }>;
  audit: Array<{ actorId: string; action: string; entityType: string; entityId: string; createdAt: string }>;
  userNames: Map<string, string>;
  live: { clients: number; lastEventId: number };
  // Only the database holds these; absent in memory mode.
  extras?: {
    exceptions?: { open: number; critical: number; overdue: number };
    approvals?: { pending: number };
  };
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const round1 = (value: number) => Math.round(value * 10) / 10;

// How long a transfer may sit in a stage before it is "stuck" (blueprint §40).
export const STAGE_LIMIT_HOURS: Record<string, number> = {
  REQUESTED: 24, PENDING_PICK: 24, PICKING: 24, PARTIAL: 24, READY_FOR_ADMIN: 12, CONFIRMED: 24,
  DISPATCHED: 72, IN_TRANSIT: 72, PARTIAL_RECEIVED: 48, PARTIALLY_RECEIVED: 48,
};
const OPEN_TRANSFER = Object.keys(STAGE_LIMIT_HOURS);

/** When the transfer entered its current stage, as best the record knows. */
export function stageSince(transfer: TransferRecord): string {
  if (['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED'].includes(transfer.status) && transfer.dispatch?.dispatchedAt) return transfer.dispatch.dispatchedAt;
  if (transfer.status === 'CONFIRMED' && transfer.packing?.completedAt) return transfer.packing.completedAt;
  return transfer.createdAt;
}

export function stuckTransfers(transfers: TransferRecord[], now: Date) {
  const rows = transfers
    .filter((transfer) => OPEN_TRANSFER.includes(transfer.status))
    .map((transfer) => {
      const ageHours = round1((now.getTime() - Date.parse(stageSince(transfer))) / HOUR);
      const limit = STAGE_LIMIT_HOURS[transfer.status];
      const late = transfer.dispatch?.expectedArrivalAt && Date.parse(transfer.dispatch.expectedArrivalAt) < now.getTime()
        && ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED'].includes(transfer.status);
      return { transferId: transfer.id, stage: transfer.status, ageHours, limitHours: limit, from: transfer.sourceLocationId, to: transfer.destinationLocationId, pastPromise: Boolean(late) };
    })
    .filter((row) => row.ageHours > row.limitHours || row.pastPromise)
    .sort((a, b) => b.ageHours - a.ageHours);
  const byStage: Record<string, number> = {};
  for (const row of rows) byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
  return { rows, byStage };
}

function syncAgeHours(checkpoints: CommandCenterInput['checkpoints'], locationId: string, source: 'SALES' | 'PURCHASE', now: Date): number | null {
  const found = checkpoints.find((row) => row.locationId === locationId && row.sourceType === source);
  return found ? round1((now.getTime() - Date.parse(found.syncedThroughAt)) / HOUR) : null;
}

const dayKey = (iso: string) => iso.slice(0, 10);

export function lastDays(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, index) => new Date(now.getTime() - (count - 1 - index) * DAY).toISOString().slice(0, 10));
}

export function buildCommandCenter(input: CommandCenterInput) {
  const { now } = input;
  const nowMs = now.getTime();
  const stuck = stuckTransfers(input.transfers, now);
  const overdueAssignments = input.assignments.filter((row) => row.status === 'ASSIGNED' && row.dueDate && Date.parse(row.dueDate) < nowMs);
  const openAssignments = input.assignments.filter((row) => row.status === 'ASSIGNED');
  const pendingReview = input.counts.filter((count) => (count.status ?? 'PENDING_REVIEW') === 'PENDING_REVIEW');
  const slowReview = pendingReview.filter((count) => nowMs - Date.parse(count.createdAt) > DAY);
  const needsReconciliation = input.counts.filter((count) => count.reconciliationRequired);

  // ---- Is inventory synchronized? / Which branch is behind? -----------------
  const branchHealth = input.locations.map((location) => {
    const sales = syncAgeHours(input.checkpoints, location.id, 'SALES', now);
    const purchase = syncAgeHours(input.checkpoints, location.id, 'PURCHASE', now);
    const reasons: Array<{ severity: Severity; text: string }> = [];
    const isStore = location.type !== 'warehouse';
    if (isStore) {
      if (sales === null) reasons.push({ severity: 'CRITICAL', text: 'No sales file has ever been imported.' });
      else if (sales > 48) reasons.push({ severity: 'CRITICAL', text: `Sales are ${Math.round(sales)} hours behind.` });
      else if (sales > 30) reasons.push({ severity: 'WARNING', text: `Sales are ${Math.round(sales)} hours behind.` });
    }
    if (purchase !== null && purchase > 96) reasons.push({ severity: 'WARNING', text: `Purchases are ${Math.round(purchase)} hours behind.` });
    const overdue = overdueAssignments.filter((row) => row.locationId === location.id).length;
    if (overdue) reasons.push({ severity: 'WARNING', text: `${overdue} count task(s) overdue.` });
    const review = pendingReview.filter((count) => count.locationId === location.id).length;
    const stuckHere = stuck.rows.filter((row) => row.from === location.id || row.to === location.id).length;
    if (stuckHere) reasons.push({ severity: 'CRITICAL', text: `${stuckHere} transfer(s) stuck.` });
    const recent = input.counts.filter((count) => count.locationId === location.id && nowMs - Date.parse(count.createdAt) <= 7 * DAY && (count.status === 'APPROVED' || count.status === 'REJECTED'));
    const accurate = recent.filter((count) => count.physicalQuantity === count.bookQty).length;
    return {
      locationId: location.id, name: location.name, type: location.type ?? 'store',
      status: reasons.some((row) => row.severity === 'CRITICAL') ? 'RED' : reasons.length ? 'AMBER' : 'GREEN',
      reasons: reasons.map((row) => row.text),
      salesSyncedAgeHours: sales, purchaseSyncedAgeHours: purchase,
      openAssignments: openAssignments.filter((row) => row.locationId === location.id).length,
      overdueAssignments: overdue, pendingReview: review, stuckTransfers: stuckHere,
      countAccuracy7d: recent.length ? round1((accurate / recent.length) * 100) : null,
    } as const;
  });
  const rank = { RED: 0, AMBER: 1, GREEN: 2 } as const;
  branchHealth.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));

  // ---- What needs attention now? -------------------------------------------
  const attention: Array<{ severity: Severity; key: string; title: string; count: number; section: string }> = [];
  const add = (severity: Severity, key: string, title: string, count: number, section: string) => { if (count > 0) attention.push({ severity, key, title, count, section }); };
  add('CRITICAL', 'stuck-transfers', 'Transfers stuck in a stage', stuck.rows.length, 'transfers');
  add('CRITICAL', 'stale-sales', 'Branches with sales imports more than 2 days behind', branchHealth.filter((row) => row.type !== 'warehouse' && (row.salesSyncedAgeHours === null || row.salesSyncedAgeHours > 48)).length, 'stock-update');
  add('CRITICAL', 'critical-exceptions', 'Critical exceptions open', input.extras?.exceptions?.critical ?? 0, 'exceptions');
  add('WARNING', 'overdue-counts', 'Count tasks past their due date', overdueAssignments.length, 'counts');
  add('WARNING', 'slow-review', 'Counts waiting for review over 24 hours', slowReview.length, 'counts');
  add('WARNING', 'reconcile', 'Counts needing reconciliation after late movements', needsReconciliation.length, 'stock-update');
  add('WARNING', 'overdue-exceptions', 'Exceptions past their SLA', input.extras?.exceptions?.overdue ?? 0, 'exceptions');
  add('WARNING', 'approvals', 'Approvals waiting for a decision', input.extras?.approvals?.pending ?? 0, 'approvals');
  const severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  attention.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count);

  // ---- What is moving? -------------------------------------------------------
  const days = lastDays(now, 7);
  const pulse = days.map((day) => ({
    day,
    countsSubmitted: input.counts.filter((count) => dayKey(count.createdAt) === day).length,
    transfersCreated: input.transfers.filter((transfer) => dayKey(transfer.createdAt) === day).length,
    transfersDispatched: input.transfers.filter((transfer) => transfer.dispatch && dayKey(transfer.dispatch.dispatchedAt) === day).length,
    receipts: input.audit.filter((event) => ['TRANSFER_RECEIVED', 'TRANSFER_PARTIALLY_RECEIVED'].includes(event.action) && dayKey(event.createdAt) === day).length,
  }));

  // ---- How is the team performing? ------------------------------------------
  const since = nowMs - 7 * DAY;
  const perUser = new Map<string, { counts: number; approved: number; recount: number; receipts: number; cartons: number }>();
  const bump = (userId: string) => {
    const row = perUser.get(userId) ?? { counts: 0, approved: 0, recount: 0, receipts: 0, cartons: 0 };
    perUser.set(userId, row);
    return row;
  };
  for (const count of input.counts) {
    if (Date.parse(count.createdAt) < since) continue;
    const row = bump(count.submittedBy);
    row.counts += 1;
    if (count.status === 'APPROVED') row.approved += 1;
    if (count.status === 'RECOUNT') row.recount += 1;
  }
  for (const event of input.audit) {
    if (Date.parse(event.createdAt) < since) continue;
    if (event.action === 'TRANSFER_RECEIVED' || event.action === 'TRANSFER_PARTIALLY_RECEIVED') bump(event.actorId).receipts += 1;
    if (event.action === 'TRANSFER_CARTON_SEALED') bump(event.actorId).cartons += 1;
  }
  const team = [...perUser.entries()].map(([userId, row]) => ({
    userId, name: input.userNames.get(userId) ?? userId, ...row,
    recountRate: row.counts ? round1((row.recount / row.counts) * 100) : 0,
  })).sort((a, b) => (b.counts + b.receipts + b.cartons) - (a.counts + a.receipts + a.cartons));

  // ---- Campaign heatmap: how much of each branch's count work is done, per day ----
  const heatmap = input.locations.map((location) => ({
    locationId: location.id, name: location.name,
    days: days.map((day) => {
      const rows = input.assignments.filter((row) => row.locationId === location.id && dayKey(row.countDate) === day && row.status !== 'CANCELLED');
      const done = rows.filter((row) => row.status === 'SUBMITTED').length;
      return { day, total: rows.length, done, ratio: rows.length ? round1(done / rows.length) : null };
    }),
  })).filter((row) => row.days.some((cell) => cell.total > 0));

  const liveBranches = branchHealth.filter((row) => row.type !== 'warehouse');
  return {
    generatedAt: now.toISOString(),
    attention,
    sync: {
      liveClients: input.live.clients,
      lastEventId: input.live.lastEventId,
      staleBranches: liveBranches.filter((row) => row.salesSyncedAgeHours === null || row.salesSyncedAgeHours > 30).length,
      totalBranches: liveBranches.length,
    },
    branchHealth,
    pulse,
    blocked: {
      approvals: input.extras?.approvals?.pending ?? null,
      exceptions: input.extras?.exceptions ?? null,
      stuckTransfers: stuck.rows.length,
      countsAwaitingReview: pendingReview.length,
      reconciliation: needsReconciliation.length,
    },
    stuckTransfers: stuck,
    team,
    heatmap,
    recent: [...input.audit]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 15)
      .map((event) => ({ action: event.action, entityType: event.entityType, entityId: event.entityId, at: event.createdAt, actor: input.userNames.get(event.actorId) ?? event.actorId })),
  };
}

export type CommandCenter = ReturnType<typeof buildCommandCenter>;
