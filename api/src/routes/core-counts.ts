// Stock count routes for core (Phase 4): counts, stock-count
// submissions, count assignments, cycle counts and mobile work.
// Extracted verbatim from core.ts; the composer mounts this router
// at the cluster's original registration position.
import { exceedsDefaultTolerance } from '../lib/count-tolerance.js';
import { parseCountReasonCode } from '../lib/count-reason-codes.js';
import { recordThenPersist } from '../lib/record-then-persist.js';
import { type Request, type Response, Router } from 'express';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { canAccessLocation, hidesZeroStockForRole, validateBlindCountSubmission, type BlindCountInput, type Role } from '../lib/inventory.js';
import { assertCountLocationAccess, canManageCountWork, countsOnlyWhenAssigned, isCountWorkerRole, parseCountPriority, parseCountReviewReason, parseCountReviewStatus, parseOptionalDueDate } from '../lib/count-lifecycle.js';
import { buildCycleCountPlan, cycleCountInstructions, parseAbcClasses, selectEligibleCycleCountItems } from '../lib/abc-cycle-count.js';
import { cadenceForCompany } from '../lib/cycle-count-cadence-context.js';
import { signedSalesQty } from '../lib/sales-demand.js';
import { submitStockCount } from '../lib/store.js';
import { createCountAssignment, deleteCountAssignment, createCountRecord, removeCountRecord, createRecountAssignment, findAssignmentForCount, findActiveAssignment, findPendingCountForLot, findUserById, listCountAssignments, listCounts, findCountForCompany, counts as countsStore, listItems, listDailyMovements, listLocations, listTransfers, markAssignmentSubmitted, updateCountReview, updateCountAssignment, users } from '../lib/repository.js';
import { findStockEntry, listRecentMovementItemIds, listRecentMovements, listStockForLocation } from '../lib/repositories/stock-repository.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { emitWebhookEvent, maybeEmitStockLow } from '../lib/webhook-dispatcher.js';
import { getCountRecommendation } from '../lib/count-tolerance.js';
import { isDomainError, statusForErrorCode } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { reconcileCampaignQuietly } from '../lib/campaign-service.js';
import { allocateWeightCount, totalVariance } from '../lib/weight-allocation.js';
import { publishEvent } from '../lib/event-bus.js';
import { isOperationalItem } from '../lib/item-master.js';
import { persistAssignmentSubmitted, persistAudit, persistCount, persistCountDeletion, persistCountAssignment, persistCountAssignmentDelete, persistCountAssignmentUpdate, persistCountReview, persistCountReconciliation } from '../lib/persistence.js';
import { loadMobileWork } from '../lib/mobile-work.js';
import { listCountsForCompany } from '../lib/repositories/count-repository.js';
import { listMyOpenAssignments, listOpenAssignmentsForCompany } from '../lib/repositories/count-assignment-repository.js';
import { accessContext, tenantContext, firstParam, inactiveItemMessage } from './core-shared.js';

const router = Router();

// ============================================
// COUNTS
// ============================================

router.get('/counts', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const blindCountWorker = ['STORE_USER', 'WAREHOUSE_PICKER'].includes(context.role);
  // Database-first slice 5: read through the scoped count repository (Postgres in database mode).
  const visible = (await listCountsForCompany(tenantContext(req))).filter((count) =>
    canAccessLocation(context, count.locationId)
    && (!blindCountWorker || count.submittedBy === req.user!.id),
  );
  if (blindCountWorker) {
    return res.json({
      counts: visible.map((count) => ({
        id: count.id,
        itemId: count.itemId,
        lotId: count.lotId,
        locationId: count.locationId,
        physicalQuantity: count.physicalQuantity,
        mode: count.mode,
        submittedBy: count.submittedBy,
        role: count.role,
        createdAt: count.createdAt,
        status: count.status,
        reviewedAt: count.reviewedAt,
        parentCountId: count.parentCountId,
      })),
    });
  }
  // Blueprint §10.2: attach a tolerance recommendation to every count still
  // awaiting review, so the reviewer sees it alongside the variance -
  // never applied automatically, just surfaced (best-effort; a
  // recommendation-engine failure never blocks the count list itself).
  const counts = await Promise.all(visible.map(async (count) => {
    const variance = count.physicalQuantity - count.bookQty;
    const toleranceRecommendation = count.status === 'PENDING_REVIEW'
      ? await getCountRecommendation(tenantContext(req), { itemId: count.itemId, locationId: count.locationId, bookQty: count.bookQty, physicalQty: count.physicalQuantity })
      : null;
    return { ...count, variance, toleranceRecommendation };
  }));
  return res.json({ counts });
});

// Blueprint v4 §14: a reviewer acknowledges a late-movement flag once they have
// looked at it (and adjusted stock if needed). The recomputed figures stay on
// the count for the audit trail.
router.post('/stock-counts/:countId/reconciliation/ack', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Only admins and branch managers can resolve a reconciliation flag.' });
  const count = findCountForCompany(firstParam(req.params.countId), req.companyId ?? DEFAULT_COMPANY_ID);
  if (!count) return res.status(404).json({ message: 'Stock count was not found.' });
  if (!canAccessLocation(accessContext(req.user!), count.locationId)) return res.status(403).json({ message: 'This user cannot review counts at that location.' });
  if (!count.reconciliationRequired) return res.status(409).json({ message: 'This count has no open reconciliation flag.' });
  let note: string;
  try {
    note = parseCountReviewReason(req.body?.note);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'A resolution note is required.' });
  }
  const stored = countsStore.find((candidate) => candidate.id === count.id)!;
  stored.reconciliationRequired = false;
  stored.reconciliationNote = `${stored.reconciliationNote ?? ''} Resolved by ${req.user!.id}: ${note}`.trim();
  await persistCountReconciliation(stored, req.companyId ?? DEFAULT_COMPANY_ID);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'COUNT_RECONCILIATION_RESOLVED', entityType: 'StockCount', entityId: count.id, metadata: { note, lateDelta: stored.lateDelta } }));
  publishEvent({ topic: 'count.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [count.locationId] });
  return res.json({ success: true, count: { ...stored, variance: stored.physicalQuantity - stored.bookQty } });
});

// Blueprint v4 §38: a client-generated idempotency key makes a retried submit
// (offline outbox, request timeout) return the count it already created.
function parseRequestId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 191) throw new Error('requestId must be text of at most 191 characters.');
  return value.trim() || undefined;
}

/** True when the count was made against a task assigned to its submitter (a lot of a multi-lot task included). */
function countWasAssignedWork(count: { itemId: string; locationId: string; submittedBy: string; createdAt: string }): boolean {
  return listCountAssignments().some((assignment) => assignment.assignedToId === count.submittedBy
    && assignment.itemId === count.itemId && assignment.locationId === count.locationId && assignment.createdAt <= count.createdAt);
}

function countsForRequest(userId: string, requestId: string) {
  return listCounts().filter((count) => count.submittedBy === userId && count.requestId === requestId);
}

// A store user stays blind to book quantity and variance in every response.
function countResponse(role: string, count: { id: string; itemId: string; lotId: string; locationId: string; physicalQuantity: number; bookQty: number }) {
  return ['STORE_USER', 'WAREHOUSE_PICKER'].includes(role)
    ? { id: count.id, itemId: count.itemId, lotId: count.lotId, locationId: count.locationId, physicalQuantity: count.physicalQuantity }
    : { ...count, variance: count.physicalQuantity - count.bookQty };
}

type LotCountArgs = {
  ctx: TenantContext;
  userId: string;
  userRole: string;
  role: Role;
  item: ReturnType<typeof listItems>[number];
  lot: ReturnType<typeof listItems>[number]['lots'][number];
  locationId: string;
  physicalQuantity: number;
  mode: 'scan' | 'manual' | 'weight';
  requestId?: string;
  assignment?: ReturnType<typeof findActiveAssignment>;
  companyId?: string;
  // 'auto' closes the assignment once every lot with stock is counted (scan
  // counts); weight counts close it themselves after allocating the item total.
  closeAssignment: 'auto' | 'never';
};

/** Records one lot's count: memory + database + audit, and the assignment/campaign bookkeeping. */
async function commitLotCount(args: LotCountArgs) {
  const { item, lot, assignment } = args;
  // Phase 5 step 7: the book quantity a count is compared against is the
  // current database row (stock repository), not the snapshot — the
  // snapshot's "as of last reconcile" figure could bless or condemn a
  // count on stale data. One repository read serves the book quantity and
  // the assignment's required-lots check below.
  const ledger = await listStockForLocation(args.ctx, args.locationId);
  const onHandOf = (lotId: string) => ledger.find((row) => row.itemId === item.id && row.lotId === lotId)?.onHand ?? 0;
  const bookQty = onHandOf(lot.id);
  const saved = submitStockCount({
    itemId: item.id,
    lotId: lot.id,
    locationId: args.locationId,
    physicalQuantity: args.physicalQuantity,
    mode: args.mode,
    submittedBy: args.userId,
    role: args.role,
  });
  // Memory first, database second, and the memory copy is withdrawn if the database refuses.
  await recordThenPersist(
    () => createCountRecord({
      id: saved.id,
      itemId: saved.itemId,
      lotId: saved.lotId,
      locationId: saved.locationId,
      physicalQuantity: saved.physicalQuantity,
      bookQty,
      mode: saved.mode,
      submittedBy: saved.submittedBy,
      role: saved.role,
      createdAt: saved.createdAt,
      parentCountId: assignment?.parentCountId,
      requestId: args.requestId,
      companyId: args.companyId,
    }),
    () => persistCount({ ...saved, bookQty, status: 'PENDING_REVIEW', parentCountId: assignment?.parentCountId, requestId: args.requestId }, args.companyId),
    (record) => removeCountRecord(record.id),
  );
  const followUps: Promise<unknown>[] = [
    persistAudit(recordAudit({ actorId: args.userId, actorRole: args.userRole, action: 'STOCK_COUNT_SUBMITTED', entityType: 'StockCount', entityId: saved.id })),
  ];
  if (assignment && args.closeAssignment === 'auto') {
    const requiredLotIds = item.lots
      .filter((candidate) => onHandOf(candidate.id) !== 0)
      .map((candidate) => candidate.id);
    const countedLotIds = new Set(
      listCounts()
        .filter((count) => count.itemId === item.id && count.locationId === args.locationId && count.submittedBy === args.userId && count.createdAt >= assignment.createdAt)
        .map((count) => count.lotId),
    );
    countedLotIds.add(saved.lotId);
    if (requiredLotIds.length === 0 || requiredLotIds.every((lotId) => countedLotIds.has(lotId))) {
      markAssignmentSubmitted(assignment.id, saved.id);
      followUps.push(persistAssignmentSubmitted(assignment.id, saved.id));
      // A campaign task just moved to SUBMITTED: keep coverage in step.
      followUps.push(reconcileCampaignQuietly(assignment.campaignId));
    }
  }
  await Promise.all(followUps);
  return { saved, bookQty };
}

router.post('/stock-counts', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const input = req.body as BlindCountInput;

  if (!canAccessLocation(context, input.locationId)) {
    return res.status(403).json({ message: 'This user cannot submit a count for the selected location.' });
  }

  try {
    const validated = validateBlindCountSubmission(context.role, input);
    const requestId = parseRequestId(input.requestId);
    if (requestId) {
      const [prior] = countsForRequest(req.user!.id, requestId);
      if (prior) return res.status(200).json({ success: true, duplicate: true, count: countResponse(context.role, prior) });
    }

    const item = listItems().find((candidate) => candidate.id === validated.itemId);
    if (!item) return res.status(400).json({ message: 'Item was not found.' });
    if (!isOperationalItem(item)) return res.status(400).json({ message: `Item ${item.code} is ${String(item.status).toLowerCase()} and cannot be counted.` });

    const lot = validated.lotNo
      ? item.lots.find((candidate) => candidate.lotNo.toLowerCase() === validated.lotNo!.toLowerCase())
      : item.lots[0];
    if (!lot) return res.status(400).json({ message: `Lot "${validated.lotNo}" was not found for this item.` });

    // Blueprint v4 §13: pieces are whole numbers; only weight / decimal items take fractions.
    if (!item.decimalQuantity && item.countMethod !== 'ITEM_WEIGHT' && !Number.isInteger(validated.physicalQuantity)) {
      return res.status(400).json({ message: `Item ${item.code} is counted in whole units.` });
    }

    // Blueprint v4 §7: operational users never act on a zero-stock lot.
    if (hidesZeroStockForRole(context.role) && ((await findStockEntry(tenantContext(req), item.id, lot.id, validated.locationId))?.onHand ?? 0) <= 0) {
      return res.status(400).json({ message: `Lot ${lot.lotNo} has no stock at this location and cannot be counted.` });
    }

    if (findPendingCountForLot(req.user!.id, item.id, lot.id, validated.locationId)) {
      return res.status(409).json({ message: 'This lot is already submitted and waiting for review.' });
    }

    // Store Users may only count what Admin assigned them; Admin can record ad hoc counts freely.
    // A branch manager may do either - a count of an item assigned to them closes that task.
    const assignment = isCountWorkerRole(context.role) ? findActiveAssignment(req.user!.id, item.id, validated.locationId) : undefined;
    if (!assignment && countsOnlyWhenAssigned(context.role)) {
      return res.status(403).json({ message: 'This item is not assigned to you for counting at this location.' });
    }

    const { saved, bookQty } = await commitLotCount({
      ctx: tenantContext(req),
      userId: req.user!.id, userRole: req.user!.role, role: context.role, item, lot, locationId: validated.locationId,
      physicalQuantity: validated.physicalQuantity, mode: validated.mode ?? 'manual', requestId, assignment, closeAssignment: 'auto',
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    });
    publishEvent({ topic: 'count.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [validated.locationId] });
    if (assignment) publishEvent({ topic: 'assignment.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [validated.locationId] });
    return res.status(201).json({ success: true, count: countResponse(context.role, { ...saved, bookQty }) });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid stock count payload' });
  }
});

// Blueprint v4 §13.2: loose KG / item-weight counting. The user enters one
// decimal total for the item; the server spreads it over the item's lots in
// FIFO/FEFO order (lib/weight-allocation.ts) and creates a count per lot. The
// user never picks or splits lots, and a store user is never shown the split
// (it would reveal the book quantities the count is blind to).
const weightInFlight = new Set<string>();

router.post('/stock-counts/weight', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const input = req.body as { itemId?: string; locationId?: string; totalQuantity?: number; requestId?: string };
  if (!input?.itemId || !input?.locationId) return res.status(400).json({ message: 'Item and location are required for a count submission.' });
  const locationId = input.locationId;
  if (!canAccessLocation(context, locationId)) {
    return res.status(403).json({ message: 'This user cannot submit a count for the selected location.' });
  }
  try {
    const total = Number(input.totalQuantity);
    if (input.totalQuantity === undefined || input.totalQuantity === null || (input.totalQuantity as unknown) === '' || !Number.isFinite(total) || total < 0) {
      return res.status(400).json({ message: 'Counted quantity must be a non-negative number.' });
    }
    const requestId = parseRequestId(input.requestId);
    if (requestId) {
      const prior = countsForRequest(req.user!.id, requestId);
      if (prior.length) {
        return res.status(200).json({
          success: true, duplicate: true,
          ...(context.role === 'STORE_USER' ? { lots: prior.length } : { counts: prior.map((count) => countResponse(context.role, count)) }),
        });
      }
    }

    const item = listItems().find((candidate) => candidate.id === input.itemId);
    if (!item) return res.status(400).json({ message: 'Item was not found.' });
    if (!isOperationalItem(item)) return res.status(400).json({ message: `Item ${item.code} is ${String(item.status).toLowerCase()} and cannot be counted.` });
    if (item.countMethod !== 'ITEM_WEIGHT') {
      return res.status(400).json({ message: `Item ${item.code} is counted by scanning lots, not by weight.` });
    }

    let assignment;
    if (context.role === 'STORE_USER') {
      assignment = findActiveAssignment(req.user!.id, item.id, locationId);
      if (!assignment) return res.status(403).json({ message: 'This item is not assigned to you for counting at this location.' });
    }

    const weightLedger = await listStockForLocation(tenantContext(req), locationId);
    const lots = item.lots.map((lot) => ({
      lotId: lot.id, lotNo: lot.lotNo, expiryDate: lot.expiryDate, status: lot.status,
      bookQty: weightLedger.find((row) => row.itemId === item.id && row.lotId === lot.id)?.onHand ?? 0,
    }));
    const allocation = allocateWeightCount(total, lots, item.allocationStrategy ?? 'FEFO');
    if (allocation.some((row) => findPendingCountForLot(req.user!.id, item.id, row.lotId, locationId))) {
      return res.status(409).json({ message: 'This item is already submitted and waiting for review.' });
    }

    // A weight count is all-or-nothing: if one lot cannot be saved the others are withdrawn,
    // so a retry never finds half a count and calls it done.
    const flightKey = requestId ? `${req.user!.id}|${requestId}` : '';
    if (flightKey && weightInFlight.has(flightKey)) return res.status(409).json({ message: 'This count is already being saved. Retry in a moment.' });
    if (flightKey) weightInFlight.add(flightKey);
    const saved: Array<Awaited<ReturnType<typeof commitLotCount>>> = [];
    try {
      for (const row of allocation) {
        const lot = item.lots.find((candidate) => candidate.id === row.lotId)!;
        saved.push(await commitLotCount({
          ctx: tenantContext(req),
          userId: req.user!.id, userRole: req.user!.role, role: context.role, item, lot, locationId,
          physicalQuantity: row.physicalQty, mode: 'weight', requestId, assignment, closeAssignment: 'never',
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        }));
      }
    } catch (error) {
      for (const row of saved) {
        removeCountRecord(row.saved.id);
        await persistCountDeletion(row.saved.id, req.companyId ?? DEFAULT_COMPANY_ID).catch(() => undefined);
      }
      throw error;
    } finally {
      if (flightKey) weightInFlight.delete(flightKey);
    }
    // The whole item was counted in one entry, so the task is complete now.
    if (assignment) {
      markAssignmentSubmitted(assignment.id, saved[0].saved.id);
      await Promise.all([persistAssignmentSubmitted(assignment.id, saved[0].saved.id), reconcileCampaignQuietly(assignment.campaignId)]);
    }

    publishEvent({ topic: 'count.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [locationId] });
    if (assignment) publishEvent({ topic: 'assignment.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [locationId] });
    if (context.role === 'STORE_USER') return res.status(201).json({ success: true, lots: saved.length });
    return res.status(201).json({
      success: true,
      counts: saved.map((row) => countResponse(context.role, { ...row.saved, bookQty: row.bookQty })),
      allocation: allocation.map((row) => ({ lotId: row.lotId, lotNo: row.lotNo, bookQty: row.bookQty, physicalQuantity: row.physicalQty })),
      totalVariance: totalVariance(allocation),
    });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid weight count payload' });
  }
});

router.patch('/stock-counts/:countId/review', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can review stock counts.' });
  }

  let status;
  let reviewReason;
  let reasonCode;
  try {
    status = parseCountReviewStatus(req.body.status);
    reviewReason = parseCountReviewReason(req.body.reviewReason ?? req.body.reason);
    reasonCode = parseCountReasonCode(req.body.reasonCode);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid review payload.' });
  }

  try {
    const countId = firstParam(req.params.countId);
    const current = findCountForCompany(countId, req.companyId ?? DEFAULT_COMPANY_ID);
    if (!current) return res.status(404).json({ message: 'Stock count was not found.' });
    if (current.status !== 'PENDING_REVIEW') return res.status(409).json({ message: `Count is already ${current.status} and cannot be reviewed again.` });
    // Branch managers can be assigned count work too: whoever was handed the count cannot also approve it.
    // (An admin's own ad hoc count has no assignment behind it and stays reviewable as before.)
    if (current.submittedBy === req.user!.id && countWasAssignedWork(current)) {
      return res.status(403).json({ message: 'You cannot review a count you were assigned and submitted yourself.', code: 'SELF_REVIEW' });
    }
    try {
      assertCountLocationAccess(accessContext(req.user!), current.locationId);
    } catch {
      return res.status(403).json({ message: 'This user cannot review counts at the selected location.' });
    }
    // Optional enforcement (COUNT_ENFORCE_RECOUNT=true, audit C-1): a first count whose variance is outside the
    // default tolerance cannot be approved as is - it must go to a recount, which is then a second, independent count.
    if (process.env.COUNT_ENFORCE_RECOUNT === 'true' && status === 'APPROVED' && !current.parentCountId
      && exceedsDefaultTolerance(current.bookQty, Math.abs(current.physicalQuantity - current.bookQty))) {
      return res.status(409).json({ message: 'This variance is outside tolerance. Request a recount instead of approving the first count.', code: 'RECOUNT_REQUIRED' });
    }
    // A recount must be independent: the same person re-counting their own first count proves nothing (audit C-1).
    if (process.env.COUNT_ENFORCE_RECOUNT === 'true' && status === 'APPROVED' && current.parentCountId) {
      const parent = listCounts().find((count) => count.id === current.parentCountId);
      if (parent && parent.submittedBy === current.submittedBy) {
        return res.status(409).json({ message: 'A recount must be done by a different person than the first count.', code: 'RECOUNT_NOT_INDEPENDENT' });
      }
    }
    const reviewedAt = new Date().toISOString();
    // Claim and post the variance in the database before mutating the in-memory mirror.
    // The conditional database update makes concurrent/retried approvals exactly-once.
    await persistCountReview({ ...current, status, reviewedBy: req.user!.id, reviewedAt, reviewReason, reasonCode }, req.companyId ?? DEFAULT_COMPANY_ID);
    const updated = updateCountReview(countId, status, req.user!.id, reviewReason, reasonCode);
    const variance = updated.physicalQuantity - updated.bookQty;
    const reviewedCampaignId = findAssignmentForCount(countId)?.campaignId;
    let recountAssignment;
    if (status === 'RECOUNT') {
      const recount = createRecountAssignment(updated, req.user!.id);
      recountAssignment = recount.assignment;
      if (recount.cancelled) await persistCountAssignmentUpdate(recount.cancelled);
      await persistCountAssignment(recountAssignment);
    }
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: `STOCK_COUNT_${status}`,
      entityType: 'StockCount',
      entityId: updated.id,
      metadata: {
        reviewReason,
        reasonCode,
        ...(status === 'APPROVED' ? { bookQty: updated.bookQty, physicalQuantity: updated.physicalQuantity, variance, movementId: updated.varianceMovementId } : {}),
        ...(status === 'RECOUNT' ? { recountAssignmentId: recountAssignment?.id } : {}),
      },
    }));
    void emitWebhookEvent({
      type: 'count.reviewed',
      entityId: updated.id,
      data: {
        countId: updated.id,
        status,
        itemId: updated.itemId,
        locationId: updated.locationId,
        physicalQuantity: updated.physicalQuantity,
        reviewReason,
      },
    });
    if (status === 'APPROVED') void maybeEmitStockLow(tenantContext(req), updated.itemId, updated.locationId, updated.bookQty);
    publishEvent({ topic: 'count.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [updated.locationId] });
    publishEvent({ topic: 'assignment.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [updated.locationId] });
    await reconcileCampaignQuietly(reviewedCampaignId);
    return res.json({ success: true, count: { ...updated, variance }, recountAssignment });
  } catch (error) {
    if (isDomainError(error)) {
      return res.status(statusForErrorCode(error.code)).json(error.toEnvelope());
    }
    const message = error instanceof Error ? error.message : 'Stock count was not found.';
    return res.status(message.includes('not found') ? 404 : 400).json({ message });
  }
});

// ============================================
// COUNT ASSIGNMENTS
// ============================================

router.post('/count-assignments', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can assign stock counts.' });
  }

  const { locationId, storeUserId, itemIds, countDate, dueDate, priority, instructions } = req.body as {
    locationId?: string;
    storeUserId?: string;
    itemIds?: string[];
    countDate?: string;
    dueDate?: string;
    priority?: string;
    instructions?: string;
  };

  if (!locationId || !storeUserId || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ message: 'locationId, storeUserId and a non-empty itemIds array are required.' });
  }

  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot assign counts at the selected location.' });
  }

  const storeUser = findUserById(storeUserId);
  if (!storeUser || !isCountWorkerRole(storeUser.role)) {
    return res.status(400).json({ message: 'storeUserId must belong to an existing count worker.' });
  }
  if (!canAccessLocation({ role: storeUser.role, assignedLocationIds: storeUser.assignedLocationIds }, locationId)) {
    return res.status(400).json({ message: 'That Store User is not assigned to this location.' });
  }

  const knownItemIds = new Set(listItems().map((item) => item.id));
  const unknownItemId = itemIds.find((id) => !knownItemIds.has(id));
  if (unknownItemId) {
    return res.status(400).json({ message: `Item "${unknownItemId}" was not found.` });
  }
  const inactiveAssignItem = inactiveItemMessage(itemIds);
  if (inactiveAssignItem) return res.status(400).json({ message: inactiveAssignItem });

  let parsedDueDate: string | undefined;
  let parsedPriority;
  try {
    parsedDueDate = parseOptionalDueDate(dueDate);
    parsedPriority = parseCountPriority(priority);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid assignment payload.' });
  }

  const createdAssignments = itemIds.map((itemId) => createCountAssignment({
    id: `assign-${Math.random().toString(36).slice(2, 10)}`,
    locationId,
    itemId,
    assignedToId: storeUserId,
    assignedById: req.user!.id,
    countDate: countDate ? new Date(countDate).toISOString() : new Date().toISOString(),
    dueDate: parsedDueDate,
    priority: parsedPriority,
    instructions,
  }));

  await Promise.all(createdAssignments.map((assignment) => persistCountAssignment(assignment)));
  await persistAudit(recordAudit({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'COUNT_ASSIGNED',
    entityType: 'CountAssignment',
    entityId: createdAssignments[0].id,
    metadata: { locationId, storeUserId, itemIds, countDate: createdAssignments[0].countDate },
  }));

  return res.status(201).json({ success: true, assignments: createdAssignments });
});


router.patch('/count-assignments/:assignmentId', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'ADMIN_USER';
  const assignmentId = firstParam(req.params.assignmentId);
  const current = listCountAssignments().find((candidate) => candidate.id === assignmentId);
  if (!current) return res.status(404).json({ message: 'Count assignment was not found.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), current.locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot update assignments at the selected location.' });
  }
  if (current.status === 'SUBMITTED' && !isAdmin) return res.status(409).json({ message: 'Submitted work is immutable for branch managers; an admin can modify the task metadata.' });
  const assignedToId = typeof req.body.assignedToId === 'string' ? req.body.assignedToId : current.assignedToId;
  const assignee = findUserById(assignedToId);
  if (!assignee || !isCountWorkerRole(assignee.role) || !assignee.assignedLocationIds.includes(current.locationId)) {
    return res.status(400).json({ message: 'Assignee must be a Store User assigned to this location.' });
  }
  const countDate = req.body.countDate ? new Date(req.body.countDate) : new Date(current.countDate);
  if (Number.isNaN(countDate.getTime())) return res.status(400).json({ message: 'Count date is invalid.' });
  let dueDate = current.dueDate;
  let priority = current.priority;
  try {
    if (req.body.dueDate !== undefined) dueDate = parseOptionalDueDate(req.body.dueDate);
    if (req.body.priority !== undefined) priority = parseCountPriority(req.body.priority);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid assignment payload.' });
  }
  const status = req.body.status === undefined ? current.status : String(req.body.status).toUpperCase();
  if (!['ASSIGNED', 'CANCELLED', 'SUBMITTED'].includes(status)) return res.status(400).json({ message: 'Assignments can be ASSIGNED, SUBMITTED or CANCELLED.' });
  if (current.status === 'SUBMITTED' && status !== 'SUBMITTED') return res.status(409).json({ message: 'An approved/submitted task cannot be reopened; create a recount instead.' });
  const updated = updateCountAssignment(assignmentId, {
    assignedToId,
    countDate: countDate.toISOString(),
    dueDate,
    priority,
    instructions: req.body.instructions === undefined ? current.instructions : String(req.body.instructions || '').trim() || undefined,
    status: status as 'ASSIGNED' | 'CANCELLED',
  });
  await persistCountAssignmentUpdate(updated);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'COUNT_ASSIGNMENT_UPDATED', entityType: 'CountAssignment', entityId: updated.id, metadata: { assignedToId: updated.assignedToId, countDate: updated.countDate, status: updated.status } }));
  return res.json({ assignment: updated });
});

router.delete('/count-assignments/bulk', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Only admins can delete count tasks.' });
  const assignmentIds: string[] = Array.isArray(req.body.assignmentIds)
    ? [...new Set((req.body.assignmentIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))]
    : [];
  if (!assignmentIds.length) return res.status(400).json({ message: 'Select at least one count task to delete.' });

  const byId = new Map(listCountAssignments().map((assignment) => [assignment.id, assignment]));
  const missingIds = assignmentIds.filter((assignmentId) => !byId.has(assignmentId));
  if (missingIds.length) return res.status(404).json({ message: 'One or more count tasks were not found.', missingIds });
  const selected = assignmentIds.map((assignmentId) => byId.get(assignmentId)!);
  try {
    selected.forEach((assignment) => assertCountLocationAccess(accessContext(req.user!), assignment.locationId));
  } catch {
    return res.status(403).json({ message: 'This admin cannot delete one or more selected tasks.' });
  }

  const removed = [];
  try {
    for (const assignment of selected) {
      const deleted = deleteCountAssignment(assignment.id);
      removed.push(deleted);
      await persistCountAssignmentDelete(assignment.id);
    }
  } catch (error) {
    removed.forEach((assignment) => createCountAssignment(assignment));
    throw error;
  }

  await Promise.all(selected.map((assignment) => persistAudit(recordAudit({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'COUNT_ASSIGNMENT_DELETED',
    entityType: 'CountAssignment',
    entityId: assignment.id,
    metadata: { status: assignment.status, countId: assignment.countId, bulk: true },
  }))));
  publishEvent({ topic: 'assignment.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [...new Set(selected.map((assignment) => assignment.locationId))] });
  return res.json({ success: true, deletedCount: selected.length, assignmentIds, preservedCountIds: selected.map((assignment) => assignment.countId ?? null) });
});

router.delete('/count-assignments/:assignmentId', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Only admins can delete count tasks.' });
  const assignmentId = firstParam(req.params.assignmentId);
  const current = listCountAssignments().find((candidate) => candidate.id === assignmentId);
  if (!current) return res.status(404).json({ message: 'Count assignment was not found.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), current.locationId);
  } catch {
    return res.status(403).json({ message: 'This admin cannot delete a task at the selected location.' });
  }
  const removed = deleteCountAssignment(assignmentId);
  try {
    await persistCountAssignmentDelete(assignmentId);
  } catch (error) {
    createCountAssignment(removed);
    throw error;
  }
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'COUNT_ASSIGNMENT_DELETED', entityType: 'CountAssignment', entityId: assignmentId, metadata: { status: current.status, countId: current.countId } }));
  publishEvent({ topic: 'assignment.changed', companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationIds: [current.locationId] });
  return res.json({ success: true, assignmentId, preservedCountId: current.countId ?? null });
});
router.get('/count-assignments/mine', async (req: Request, res: Response) => {
  if (!isCountWorkerRole(req.user!.role)) {
    return res.status(403).json({ message: 'Only assigned count workers have a count task list.' });
  }
  // Database-first slice 7: the worker's own open tasks, with item name/code, straight from Postgres.
  return res.json({ assignments: await listMyOpenAssignments(tenantContext(req)) });
});

// Blueprint v4 §37: the mobile app is task-first. This is the one call a
// phone needs to render its Work tab: the user's open count tasks (only
// items that still have counted-in stock at the location, with only the lots
// worth counting and no quantities, so the blind count stays blind) and the
// transfers waiting to be received at their branch. No full catalog.
// Database-first slice 8: the response is built by lib/mobile-work.ts (Postgres in database mode).
router.get('/mobile/work', async (req: Request, res: Response) => {
  return res.json(await loadMobileWork(tenantContext(req), accessContext(req.user!)));
});

router.get('/count-assignments', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can view count assignments.' });
  }
  const context = accessContext(req.user!);
  // Database-first slice 3: read through the scoped assignment repository (Postgres in database mode).
  const assignments = (await listOpenAssignmentsForCompany(tenantContext(req)))
    .filter((assignment) => canAccessLocation(context, assignment.locationId));
  return res.json({ assignments });
});

const CYCLE_COUNT_DEMAND_WINDOW_DAYS = 90;

/** Net units sold at a location in the last `windowDays` (audit C-4: usage-value ABC ranking), from the journal via the stock repository (Phase 5 step 7 — the snapshot's stockMovements array it used before is never hydrated, so this silently emptied on every restart) plus the legacy daily sales import. */
async function unitsSoldByItemForLocation(ctx: TenantContext, locationId: string, windowDays: number, now: Date): Promise<Map<string, number>> {
  const since = now.getTime() - windowDays * 86_400_000;
  const totals = new Map<string, number>();
  const add = (itemId: string, delta: number) => totals.set(itemId, (totals.get(itemId) ?? 0) + delta);
  for (const m of await listRecentMovements(ctx, { locationId, movementTypes: ['SALES_DEDUCTION', 'SALES_RETURN'], since: new Date(since) })) {
    add(m.itemId, signedSalesQty(m.movementType, m.qtyDelta));
  }
  for (const m of listDailyMovements()) {
    if (m.locationId !== locationId || m.sourceType !== 'SALES' || !['SALE_OUT', 'SALES_RETURN'].includes(m.movementType)) continue;
    if (new Date(m.transactionAt).getTime() < since) continue;
    add(m.itemId, signedSalesQty(m.movementType, m.qtyDelta));
  }
  return totals;
}

async function cycleCountPlanForLocation(ctx: TenantContext, locationId: string, companyId: string, now = new Date()) {
  // Usage-value ranking (audit C-4) needs at least one sale in the window to mean anything - with
  // none at all (a brand-new location, or nothing has moved in 90 days) there is no usage signal,
  // so buildCycleCountPlan falls back to stock-value ranking rather than every item defaulting to
  // class C for lack of data (same "unknown is not zero" rule as gmroi/turns elsewhere).
  const unitsSoldByItem = await unitsSoldByItemForLocation(ctx, locationId, CYCLE_COUNT_DEMAND_WINDOW_DAYS, now);
  return buildCycleCountPlan({
    locationId,
    items: listItems(),
    stock: await listStockForLocation(ctx, locationId),
    assignments: listCountAssignments(),
    counts: listCounts(),
    // Audit C-4: cadence is a per-company setting now, not the fixed ABC_CADENCE constant; ABC
    // ranks by usage value (units sold x cost), not stock value on hand.
    cadenceDays: cadenceForCompany(companyId),
    ...(unitsSoldByItem.size > 0 ? { unitsSoldByItem, demandWindowDays: CYCLE_COUNT_DEMAND_WINDOW_DAYS } : {}),
    // Items sold at this location in the last 30 days: journal movements (stock repository,
    // Phase 5 step 7) and the legacy daily sales import.
    recentlySoldItemIds: new Set([
      ...(await listRecentMovementItemIds(ctx, { locationId, movementType: 'SALES_DEDUCTION', since: new Date(now.getTime() - 30 * 86_400_000) })),
      ...listDailyMovements().filter((m) => m.locationId === locationId && m.sourceType === 'SALES' && m.qtyDelta < 0 && now.getTime() - new Date(m.transactionAt).getTime() <= 30 * 86_400_000).map((m) => m.itemId),
    ]),
    // Items received into this location with damaged, short or excess quantities in the last 14 days.
    recentDiscrepancyItemIds: new Set(listTransfers()
      .filter((transfer) => transfer.destinationLocationId === locationId && now.getTime() - new Date(transfer.createdAt).getTime() <= 14 * 86_400_000)
      .flatMap((transfer) => transfer.lines.filter((line) => (line.damagedQty ?? 0) > 0 || (line.shortageQty ?? 0) > 0 || (line.excessQty ?? 0) > 0).map((line) => line.itemId))),
    now,
  });
}

router.get('/cycle-counts/:locationId', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can view the cycle-count planner.' });
  }
  const locationId = firstParam(req.params.locationId);
  const location = listLocations().find((candidate) => candidate.id === locationId);
  if (!location) return res.status(404).json({ message: 'Location was not found.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot manage counts at the selected location.' });
  }
  return res.json({ plan: await cycleCountPlanForLocation(tenantContext(req), locationId, req.companyId ?? DEFAULT_COMPANY_ID) });
});

router.post('/cycle-counts/:locationId/assign', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins and branch managers can assign cycle counts.' });
  }
  const locationId = firstParam(req.params.locationId);
  const location = listLocations().find((candidate) => candidate.id === locationId);
  if (!location) return res.status(404).json({ message: 'Location was not found.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot assign counts at the selected location.' });
  }

  const { storeUserId, classes, itemIds } = req.body as {
    storeUserId?: string;
    classes?: unknown;
    itemIds?: unknown;
  };
  if (!storeUserId) {
    return res.status(400).json({ message: 'storeUserId is required.' });
  }

  const storeUser = findUserById(storeUserId);
  if (!storeUser || !isCountWorkerRole(storeUser.role)) {
    return res.status(400).json({ message: 'storeUserId must belong to an existing count worker.' });
  }
  if (!canAccessLocation({ role: storeUser.role, assignedLocationIds: storeUser.assignedLocationIds }, locationId)) {
    return res.status(400).json({ message: 'That Store User is not assigned to this location.' });
  }

  let parsedClasses;
  try {
    parsedClasses = parseAbcClasses(classes);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid ABC classes.' });
  }

  const requestedItemIds = Array.isArray(itemIds)
    ? [...new Set(itemIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
    : [];

  const plan = await cycleCountPlanForLocation(tenantContext(req), locationId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (requestedItemIds.length) {
    const known = new Set(plan.items.map((item) => item.itemId));
    const unknownItemId = requestedItemIds.find((id) => !known.has(id));
    if (unknownItemId) {
      return res.status(400).json({ message: `Item "${unknownItemId}" is not on the cycle-count plan for this location.` });
    }
  }

  const selected = selectEligibleCycleCountItems(plan.items, {
    classes: parsedClasses,
    itemIds: requestedItemIds,
  });
  if (selected.length === 0) {
    return res.status(400).json({ message: 'No eligible items remain for the selected ABC classes.' });
  }

  const createdAssignments = selected.map((item) => createCountAssignment({
    id: `assign-${Math.random().toString(36).slice(2, 10)}`,
    locationId,
    itemId: item.itemId,
    assignedToId: storeUserId,
    assignedById: req.user!.id,
    countDate: new Date().toISOString(),
    dueDate: item.dueDate,
    priority: item.priority,
    instructions: cycleCountInstructions(item.abcClass),
  }));

  await Promise.all(createdAssignments.map((assignment) => persistCountAssignment(assignment)));
  await persistAudit(recordAudit({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'CYCLE_COUNT_ASSIGNED',
    entityType: 'CountAssignment',
    entityId: createdAssignments[0].id,
    metadata: {
      locationId,
      storeUserId,
      classes: parsedClasses,
      itemIds: selected.map((item) => item.itemId),
    },
  }));

  return res.status(201).json({
    success: true,
    assignments: createdAssignments,
    plan: await cycleCountPlanForLocation(tenantContext(req), locationId, req.companyId ?? DEFAULT_COMPANY_ID),
  });
});

// ============================================
// TRANSFERS
// ============================================

// Week 8: GET /transfers/list and POST /transfers moved to
// routes/transfers.ts (PATCH/DELETE /transfers/:id and PATCH /transfers/:id/status followed later) (thin route -> lib/transfer-command-service.ts ->
// lib/repositories/transfer-repository.ts), the first bounded-context
// extraction out of this file. See docs/route-ownership-matrix.md.

export default router;
