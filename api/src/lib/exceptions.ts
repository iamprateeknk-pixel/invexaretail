import { prisma } from './db.js';
import { recordAudit } from './audit.js';
import { persistAudit } from './persistence.js';
import type { ExceptionCase } from '@prisma/client';

// Blueprint Module H (Returns, Damage, Quarantine & Exception Management)
// and section 18 "Exception Inbox": every damage, short/excess receipt,
// wrong item, expired stock, missing stock or QC case becomes an owned,
// prioritized, SLA-bound case instead of a silent balance correction.

export type ExceptionCaseType =
  | 'DAMAGE'
  | 'SHORT_RECEIPT'
  | 'EXCESS_RECEIPT'
  | 'WRONG_ITEM'
  | 'EXPIRED'
  | 'MISSING_STOCK'
  | 'QC_FAIL'
  | 'TRANSFER_DISCREPANCY'
  | 'COUNT_VARIANCE'
  | 'QUARANTINE';

export type ExceptionPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type CreateExceptionCaseInput = {
  type: ExceptionCaseType;
  title: string;
  description?: string | null;
  itemId?: string | null;
  lotId?: string | null;
  locationId?: string | null;
  branchId?: string | null;
  quantity?: number | null;
  sourceDocument?: string | null;
  sourceLineId?: string | null;
  ownerId?: string | null;
  reportedById: string;
  companyId: string;
  /** SLA window; defaults to 24h so nothing sits unowned overnight. */
  dueHours?: number;
};

// Priority mirrors the blueprint's own approval thresholds (section 16.2:
// "stock variance > 2% or > ₹5,000 -> recount + manager approval").
export function priorityForValue(value: number | null | undefined): ExceptionPriority {
  const v = value ?? 0;
  if (v >= 5000) return 'CRITICAL';
  if (v >= 1000) return 'HIGH';
  if (v >= 100) return 'MEDIUM';
  return 'LOW';
}

// Best-effort value-at-risk: latest known purchase cost for the item times
// the exception quantity. Returns null (never throws) when no cost history
// exists yet, so priority safely falls back to LOW rather than blocking.
export async function estimateValueAtRisk(itemId: string | null | undefined, quantity: number | null | undefined): Promise<number | null> {
  if (!itemId || !quantity) return null;
  try {
    const line = await prisma.purchaseOrderLine.findFirst({
      where: { itemId, unitCost: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
    });
    if (!line) return null;
    return Number(line.unitCost) * Number(quantity);
  } catch {
    return null;
  }
}

/**
 * Opens a new exception case. Never throws for a missing/legacy table on
 * older Hostinger databases that predate the Exception Inbox migration -
 * callers on hot workflow paths (receiving, counting) must not fail the
 * underlying stock transaction just because the case log is unavailable.
 */
export async function createExceptionCase(input: CreateExceptionCaseInput) {
  try {
    const valueAtRisk = await estimateValueAtRisk(input.itemId, input.quantity);
    const priority = priorityForValue(valueAtRisk);
    const dueAt = new Date(Date.now() + (input.dueHours ?? 24) * 3_600_000);
    const exceptionCase = await prisma.exceptionCase.create({
      data: {
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        itemId: input.itemId ?? null,
        lotId: input.lotId ?? null,
        locationId: input.locationId ?? null,
        branchId: input.branchId ?? null,
        quantity: input.quantity ?? null,
        valueAtRisk,
        priority,
        sourceDocument: input.sourceDocument ?? null,
        sourceLineId: input.sourceLineId ?? null,
        ownerId: input.ownerId ?? null,
        reportedById: input.reportedById,
        companyId: input.companyId,
        dueAt,
      },
    });
    await persistAudit(recordAudit({
      actorId: input.reportedById,
      actorRole: 'SYSTEM',
      action: 'EXCEPTION_OPENED',
      entityType: 'ExceptionCase',
      entityId: exceptionCase.id,
      metadata: { type: input.type, sourceDocument: input.sourceDocument ?? undefined, valueAtRisk, priority },
    }));
    return exceptionCase;
  } catch (error) {
    console.error('createExceptionCase failed (non-blocking):', error instanceof Error ? error.message : error);
    return null;
  }
}

export type ExceptionDisposition =
  | 'RESTOCK' | 'VENDOR_RETURN' | 'MARKDOWN' | 'DESTROY' | 'REWORK'
  | 'WRITE_OFF' | 'ACCEPT' | 'RECOUNT' | 'ESCALATE' | 'NONE';

// Dispositions that put the physical stock back into sellable on-hand.
const RETURN_TO_STOCK: ExceptionDisposition[] = ['RESTOCK', 'MARKDOWN', 'REWORK', 'ACCEPT'];
// Dispositions that permanently remove the stock from the warehouse.
const REMOVE_FROM_STOCK: ExceptionDisposition[] = ['DESTROY', 'WRITE_OFF', 'VENDOR_RETURN'];

/**
 * Blueprint Module H: closing a case with a disposition must move the
 * physical stock it describes out of quarantine, not just record a
 * decision on paper. Only cases that actually hold quarantined quantity
 * (today: DAMAGE cases opened from receiving) have anything to move -
 * every other case type resolves as a paperwork-only decision. Never
 * throws: a stock-ledger mismatch must not block closing the case, since
 * the case's audit trail is the source of truth for what was decided.
 */
export async function applyExceptionDisposition(
  exceptionCase: ExceptionCase,
  disposition: ExceptionDisposition,
  actorId: string,
): Promise<void> {
  if (!exceptionCase.itemId || !exceptionCase.lotId || !exceptionCase.locationId || !exceptionCase.quantity) return;
  if (!RETURN_TO_STOCK.includes(disposition) && !REMOVE_FROM_STOCK.includes(disposition)) return;
  try {
    await prisma.$transaction(async (tx) => {
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: exceptionCase.itemId!, lotId: exceptionCase.lotId!, locationId: exceptionCase.locationId! } },
      });
      if (!ledger || ledger.quarantine <= 0) return;
      const moveQty = Math.min(Number(exceptionCase.quantity), ledger.quarantine);
      if (moveQty <= 0) return;

      const data: { quarantine: { decrement: number }; onHand?: { increment: number }; damaged?: { increment: number }; version: { increment: number } } = {
        quarantine: { decrement: moveQty },
        version: { increment: 1 },
      };
      if (RETURN_TO_STOCK.includes(disposition)) data.onHand = { increment: moveQty };
      else data.damaged = { increment: moveQty };

      await tx.stockLedger.update({ where: { id: ledger.id }, data });
      await tx.stockMovement.create({
        data: {
          itemId: exceptionCase.itemId!,
          lotId: exceptionCase.lotId,
          locationId: exceptionCase.locationId!,
          movementType: RETURN_TO_STOCK.includes(disposition) ? 'ADJUSTMENT' : 'DAMAGE',
          qtyDelta: RETURN_TO_STOCK.includes(disposition) ? moveQty : -moveQty,
          beforeBalance: RETURN_TO_STOCK.includes(disposition) ? ledger.onHand : ledger.quarantine,
          afterBalance: RETURN_TO_STOCK.includes(disposition) ? ledger.onHand + moveQty : ledger.quarantine - moveQty,
          sourceDocument: 'ExceptionCase',
          sourceLineId: exceptionCase.id,
          actor: actorId,
          timestamp: new Date(),
          reason: `Exception disposition: ${disposition}`,
          metadata: { exceptionType: exceptionCase.type, disposition },
        },
      });
    });
  } catch (error) {
    console.error('applyExceptionDisposition failed (non-blocking):', error instanceof Error ? error.message : error);
  }
}
