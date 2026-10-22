import { recordAudit } from './audit.js';
import { campaignItems } from './campaign-store.js';
import { prisma } from './db.js';
import { publishEvent } from './event-bus.js';
import {
  deleteBlockers,
  describeBlockers,
  itemStatusOf,
  type ItemReferenceCounts,
  type ItemStatus,
} from './item-master.js';
import { databaseEnabled, persistAudit, persistItem } from './persistence.js';
import { listMemoryOrders } from './orders.js';
import { listMemoryQcInspections } from './qc-inspection.js';
import { countAssignments, counts, dailyMovements, items, stockLedger, stockMovements, transfers } from './repository.js';
import { assertItemOwnedByTenant } from './repositories/item-repository.js';
import type { TenantContext } from './tenant-context.js';

export class ItemMasterError extends Error {
  constructor(message: string, readonly status = 400, readonly blockers?: Array<{ key: string; label: string; count: number }>) {
    super(message);
  }
}

type Actor = { id: string; role: string };

/**
 * How much history an item has. In database mode the database is the source
 * of truth (the in-memory movement list is capped); in memory mode the
 * in-memory records are.
 */
export async function referenceCounts(itemId: string): Promise<ItemReferenceCounts> {
  if (!databaseEnabled) {
    return {
      stock: stockLedger.filter((row) => row.itemId === itemId && row.onHand !== 0).length,
      movements: stockMovements.filter((row) => row.itemId === itemId).length + dailyMovements.filter((row) => row.itemId === itemId).length,
      counts: counts.filter((row) => row.itemId === itemId).length,
      assignments: countAssignments.filter((row) => row.itemId === itemId).length,
      transfers: transfers.reduce((sum, transfer) => sum + transfer.lines.filter((line) => line.itemId === itemId).length, 0),
      orders: listMemoryOrders().reduce((sum, order) => sum + order.lines.filter((line) => line.itemId === itemId).length, 0),
      inspections: listMemoryQcInspections().filter((row) => row.itemId === itemId).length,
      campaigns: campaignItems.filter((row) => row.itemId === itemId).length,
    };
  }
  const [stock, stockMoves, inventoryMoves, countN, assignments, transferLines, orderLines, poLines, returnLines, inspections, exceptions, campaigns] = await Promise.all([
    prisma.stockLedger.count({ where: { itemId, onHand: { not: 0 } } }),
    prisma.stockMovement.count({ where: { itemId } }),
    prisma.inventoryMovement.count({ where: { itemId } }),
    prisma.stockCount.count({ where: { itemId } }),
    prisma.countAssignment.count({ where: { itemId } }),
    prisma.transferLine.count({ where: { itemId } }),
    prisma.orderLine.count({ where: { itemId } }),
    prisma.purchaseOrderLine.count({ where: { itemId } }),
    prisma.returnLine.count({ where: { itemId } }),
    prisma.qcInspection.count({ where: { itemId } }),
    prisma.exceptionCase.count({ where: { itemId } }),
    prisma.stockTakeCampaignItem.count({ where: { itemId } }).catch(() => 0),
  ]);
  return {
    stock,
    movements: stockMoves + inventoryMoves,
    counts: countN,
    assignments,
    transfers: transferLines,
    orders: orderLines,
    purchaseOrders: poLines,
    returns: returnLines,
    inspections,
    exceptions,
    campaigns,
  };
}

/**
 * Fails closed on tenant ownership before looking the item up in the
 * in-memory mirror - a wrong-tenant call gets the same "not found" a
 * genuinely missing item would, whether or not the caller's route already
 * checked ownership. This is the fix for the structural gap ADR-002 calls
 * out: relying only on route middleware (`itemIdOf` in
 * routes/item-master.ts) meant any *other* future caller of this service
 * would have had no ownership check at all.
 */
async function requireItem(ctx: TenantContext, itemId: string) {
  await assertItemOwnedByTenant(ctx, itemId);
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new ItemMasterError('Item was not found.', 404);
  return item;
}

/** Archive / deactivate / reactivate. History is untouched; the item just leaves operational use. */
export async function changeItemStatus(ctx: TenantContext, itemId: string, change: { status: ItemStatus; reason?: string }) {
  const actor: Actor = { id: ctx.userId, role: ctx.role };
  const companyId = ctx.companyId;
  const item = await requireItem(ctx, itemId);
  const before = itemStatusOf(item);
  if (before === change.status) return { item, changed: false };
  const now = new Date().toISOString();
  item.status = change.status;
  item.version = (item.version ?? 1) + 1;
  item.updatedById = actor.id;
  if (change.status === 'ACTIVE') {
    item.archiveReason = undefined;
    item.archivedAt = undefined;
    item.archivedById = undefined;
  } else {
    item.archiveReason = change.reason;
    item.archivedAt = now;
    item.archivedById = actor.id;
  }
  await persistItem(item, companyId);
  await persistAudit(recordAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: change.status === 'ACTIVE' ? 'ITEM_RESTORED' : change.status === 'ARCHIVED' ? 'ITEM_ARCHIVED' : 'ITEM_DEACTIVATED',
    entityType: 'Item',
    entityId: itemId,
    metadata: { code: item.code, from: before, to: change.status, reason: change.reason },
  }));
  publishEvent({ topic: 'item.changed', companyId });
  return { item, changed: true };
}

/**
 * Permanent delete is only for an item that never took part in anything.
 * With any history the item must be archived instead, so reports can still
 * explain what happened.
 */
export async function deleteItemPermanently(ctx: TenantContext, itemId: string): Promise<void> {
  const actor: Actor = { id: ctx.userId, role: ctx.role };
  const companyId = ctx.companyId;
  const item = await requireItem(ctx, itemId);
  const blockers = deleteBlockers(await referenceCounts(itemId));
  if (blockers.length) {
    throw new ItemMasterError(`"${item.code}" has history (${describeBlockers(blockers)}) and cannot be deleted. Archive it instead.`, 409, blockers);
  }
  if (databaseEnabled) {
    try {
      await prisma.$transaction([
        prisma.itemTag.deleteMany({ where: { itemId } }),
        prisma.customFieldValue.deleteMany({ where: { itemId } }),
        prisma.reorderRule.deleteMany({ where: { itemId } }),
        prisma.priceList.deleteMany({ where: { itemId } }),
        prisma.expiryAlert.deleteMany({ where: { itemId, companyId } }),
        prisma.replenishmentSuggestion.deleteMany({ where: { itemId } }),
        prisma.binStock.deleteMany({ where: { itemId, companyId } }),
        prisma.stockLedger.deleteMany({ where: { itemId, companyId } }),
        prisma.putawayTask.deleteMany({ where: { itemId } }),
        prisma.serialNumber.deleteMany({ where: { itemId } }),
        prisma.openingStockSnapshot.deleteMany({ where: { itemId } }),
        prisma.lot.deleteMany({ where: { itemId } }),
        prisma.item.delete({ where: { id: itemId, companyId } }),
      ]);
    } catch (error) {
      // A foreign key we did not anticipate means there is history after all.
      if ((error as { code?: string }).code === 'P2003') {
        throw new ItemMasterError(`"${item.code}" is still referenced elsewhere and cannot be deleted. Archive it instead.`, 409);
      }
      throw error;
    }
  }
  items.splice(items.findIndex((candidate) => candidate.id === itemId), 1);
  for (let index = stockLedger.length - 1; index >= 0; index -= 1) {
    if (stockLedger[index].itemId === itemId) stockLedger.splice(index, 1);
  }
  await persistAudit(recordAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'ITEM_DELETED',
    entityType: 'Item',
    entityId: itemId,
    metadata: { code: item.code, name: item.name },
  }));
  publishEvent({ topic: 'item.changed', companyId });
}
