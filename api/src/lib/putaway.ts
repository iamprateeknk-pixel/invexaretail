import { prisma } from './db.js';
import { recordAudit } from './audit.js';
import { persistAudit } from './persistence.js';

// Blueprint Module B / section 8.3 (Putaway): "System suggests bin using
// item category, capacity, temperature/storage class, lot/expiry and
// picking velocity." This module covers category/storage-class matching,
// capacity awareness and velocity-based zone preference; it creates a task
// for a picker to confirm rather than silently trusting the suggestion.
// Expiry-aware suggestion is not modeled here - it belongs to *picking*
// order (FEFO/FIFO lot allocation, already handled by
// warehouse-workflow.ts's allocateLots()), not to where a fresh receipt
// gets put away.

export type CreatePutawayTaskInput = {
  itemId: string;
  lotId?: string | null;
  locationId: string;
  quantity: number;
  sourceDocument?: string | null;
  sourceLineId?: string | null;
};

export type BinCandidate = {
  id: string;
  capacity: number | null;
  zone: string | null;
  pendingQty: number;
};

/**
 * Pure and unit-testable: ranks bin candidates best-first.
 *
 * Capacity: a bin whose already-pending putaway quantity plus this new
 * receipt would exceed its declared capacity is excluded, unless that
 * would exclude every candidate (a capacity signal is a soft constraint on
 * a suggestion, not a hard block on receiving). Remaining bins are ranked
 * by a fullness proxy: pendingQty/capacity when capacity is known, or
 * pendingQty/(pendingQty+1) when it isn't - the latter has no real
 * capacity to divide by, so it only asymptotically approaches "full" as
 * pending quantity grows, keeping unknown-capacity bins comparable without
 * inventing a capacity number for them.
 *
 * Velocity: for a fast-moving item, zone (assumed to sort roughly by
 * distance from the pick face, same convention as
 * pick-wave.ts's sequenceKeyForBin) is checked before fullness, so a
 * high-velocity item is steered toward the nearest zone with any room
 * rather than strictly the least-utilized bin overall.
 */
export function rankBinCandidates(candidates: BinCandidate[], ctx: { incomingQty: number; highVelocity: boolean }): string | null {
  if (!candidates.length) return null;
  const fits = candidates.filter((bin) => bin.capacity === null || bin.pendingQty + ctx.incomingQty <= bin.capacity);
  const pool = fits.length ? fits : candidates;

  const fullness = (bin: BinCandidate) => bin.capacity !== null ? bin.pendingQty / bin.capacity : bin.pendingQty / (bin.pendingQty + 1);
  const zoneRank = (bin: BinCandidate) => bin.zone ?? '~unassigned';

  const sorted = [...pool].sort((a, b) => {
    if (ctx.highVelocity) {
      const zoneCompare = zoneRank(a).localeCompare(zoneRank(b));
      if (zoneCompare !== 0) return zoneCompare;
      return fullness(a) - fullness(b);
    }
    const fullnessCompare = fullness(a) - fullness(b);
    if (fullnessCompare !== 0) return fullnessCompare;
    return zoneRank(a).localeCompare(zoneRank(b));
  });
  return sorted[0].id;
}

// A "fast mover" is an item with at least this many outbound units
// (SALES_DEDUCTION + TRANSFER_OUT) in the trailing window - a real,
// observed-throughput proxy for picking velocity rather than a modeled
// forecast.
const VELOCITY_WINDOW_DAYS = 30;
const VELOCITY_THRESHOLD_UNITS = 20;

async function suggestBin(locationId: string, itemId: string, quantity: number): Promise<string | null> {
  const bins = await prisma.bin.findMany({ where: { locationId, status: 'ACTIVE' } });
  if (!bins.length) return null;

  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { category: true } });
  const categoryMatches = item?.category ? bins.filter((bin) => bin.storageClass && bin.storageClass.toLowerCase() === item.category!.toLowerCase()) : [];
  const candidateBins = categoryMatches.length ? categoryMatches : bins;

  const [openCounts, outboundMovements] = await Promise.all([
    prisma.putawayTask.groupBy({
      by: ['suggestedBinId'],
      where: { locationId, status: 'PENDING', suggestedBinId: { in: candidateBins.map((bin) => bin.id) } },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.aggregate({
      where: {
        itemId, locationId,
        movementType: { in: ['SALES_DEDUCTION', 'TRANSFER_OUT'] },
        timestamp: { gte: new Date(Date.now() - VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
      },
      _sum: { qtyDelta: true },
    }),
  ]);
  const pendingQtyByBin = new Map(openCounts.map((row) => [row.suggestedBinId, row._sum.quantity ?? 0]));
  const highVelocity = Math.abs(outboundMovements._sum.qtyDelta ?? 0) >= VELOCITY_THRESHOLD_UNITS;

  const candidates: BinCandidate[] = candidateBins.map((bin) => ({
    id: bin.id, capacity: bin.capacity, zone: bin.zone, pendingQty: pendingQtyByBin.get(bin.id) ?? 0,
  }));
  return rankBinCandidates(candidates, { incomingQty: quantity, highVelocity });
}

/**
 * Opens a putaway task for newly received good stock. Never throws - a
 * missing/legacy table on an older Hostinger database, or any bin-lookup
 * failure, must not block the receiving transaction that already
 * committed the stock. Putaway is an organizational follow-up, not a
 * precondition for stock being on hand.
 */
export async function createPutawayTask(input: CreatePutawayTaskInput): Promise<void> {
  try {
    const suggestedBinId = await suggestBin(input.locationId, input.itemId, input.quantity);
    const task = await prisma.putawayTask.create({
      data: {
        itemId: input.itemId,
        lotId: input.lotId ?? null,
        locationId: input.locationId,
        quantity: input.quantity,
        suggestedBinId,
        sourceDocument: input.sourceDocument ?? null,
        sourceLineId: input.sourceLineId ?? null,
      },
    });
    await persistAudit(recordAudit({
      actorId: 'system', actorRole: 'SYSTEM', action: 'PUTAWAY_TASK_OPENED',
      entityType: 'PutawayTask', entityId: task.id,
      metadata: { itemId: input.itemId, locationId: input.locationId, quantity: input.quantity, suggestedBinId },
    }));
  } catch (error) {
    console.error('createPutawayTask failed (non-blocking):', error instanceof Error ? error.message : error);
  }
}
