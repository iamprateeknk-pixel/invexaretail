"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ItemMasterError = void 0;
exports.referenceCounts = referenceCounts;
exports.changeItemStatus = changeItemStatus;
exports.deleteItemPermanently = deleteItemPermanently;
const audit_js_1 = require("./audit.js");
const campaign_store_js_1 = require("./campaign-store.js");
const db_js_1 = require("./db.js");
const event_bus_js_1 = require("./event-bus.js");
const item_master_js_1 = require("./item-master.js");
const persistence_js_1 = require("./persistence.js");
const orders_js_1 = require("./orders.js");
const qc_inspection_js_1 = require("./qc-inspection.js");
const repository_js_1 = require("./repository.js");
class ItemMasterError extends Error {
    status;
    blockers;
    constructor(message, status = 400, blockers) {
        super(message);
        this.status = status;
        this.blockers = blockers;
    }
}
exports.ItemMasterError = ItemMasterError;
/**
 * How much history an item has. In database mode the database is the source
 * of truth (the in-memory movement list is capped); in memory mode the
 * in-memory records are.
 */
async function referenceCounts(itemId) {
    if (!persistence_js_1.databaseEnabled) {
        return {
            stock: repository_js_1.stockLedger.filter((row) => row.itemId === itemId && row.onHand !== 0).length,
            movements: repository_js_1.stockMovements.filter((row) => row.itemId === itemId).length + repository_js_1.dailyMovements.filter((row) => row.itemId === itemId).length,
            counts: repository_js_1.counts.filter((row) => row.itemId === itemId).length,
            assignments: repository_js_1.countAssignments.filter((row) => row.itemId === itemId).length,
            transfers: repository_js_1.transfers.reduce((sum, transfer) => sum + transfer.lines.filter((line) => line.itemId === itemId).length, 0),
            orders: (0, orders_js_1.listMemoryOrders)().reduce((sum, order) => sum + order.lines.filter((line) => line.itemId === itemId).length, 0),
            inspections: (0, qc_inspection_js_1.listMemoryQcInspections)().filter((row) => row.itemId === itemId).length,
            campaigns: campaign_store_js_1.campaignItems.filter((row) => row.itemId === itemId).length,
        };
    }
    const [stock, stockMoves, inventoryMoves, countN, assignments, transferLines, orderLines, poLines, returnLines, inspections, exceptions, campaigns] = await Promise.all([
        db_js_1.prisma.stockLedger.count({ where: { itemId, onHand: { not: 0 } } }),
        db_js_1.prisma.stockMovement.count({ where: { itemId } }),
        db_js_1.prisma.inventoryMovement.count({ where: { itemId } }),
        db_js_1.prisma.stockCount.count({ where: { itemId } }),
        db_js_1.prisma.countAssignment.count({ where: { itemId } }),
        db_js_1.prisma.transferLine.count({ where: { itemId } }),
        db_js_1.prisma.orderLine.count({ where: { itemId } }),
        db_js_1.prisma.purchaseOrderLine.count({ where: { itemId } }),
        db_js_1.prisma.returnLine.count({ where: { itemId } }),
        db_js_1.prisma.qcInspection.count({ where: { itemId } }),
        db_js_1.prisma.exceptionCase.count({ where: { itemId } }),
        db_js_1.prisma.stockTakeCampaignItem.count({ where: { itemId } }).catch(() => 0),
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
function requireItem(itemId) {
    const item = repository_js_1.items.find((candidate) => candidate.id === itemId);
    if (!item)
        throw new ItemMasterError('Item was not found.', 404);
    return item;
}
/** Archive / deactivate / reactivate. History is untouched; the item just leaves operational use. */
async function changeItemStatus(itemId, change, actor, companyId) {
    const item = requireItem(itemId);
    const before = (0, item_master_js_1.itemStatusOf)(item);
    if (before === change.status)
        return { item, changed: false };
    const now = new Date().toISOString();
    item.status = change.status;
    item.version = (item.version ?? 1) + 1;
    item.updatedById = actor.id;
    if (change.status === 'ACTIVE') {
        item.archiveReason = undefined;
        item.archivedAt = undefined;
        item.archivedById = undefined;
    }
    else {
        item.archiveReason = change.reason;
        item.archivedAt = now;
        item.archivedById = actor.id;
    }
    await (0, persistence_js_1.persistItem)(item, companyId);
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
        actorId: actor.id,
        actorRole: actor.role,
        action: change.status === 'ACTIVE' ? 'ITEM_RESTORED' : change.status === 'ARCHIVED' ? 'ITEM_ARCHIVED' : 'ITEM_DEACTIVATED',
        entityType: 'Item',
        entityId: itemId,
        metadata: { code: item.code, from: before, to: change.status, reason: change.reason },
    }));
    (0, event_bus_js_1.publishEvent)({ topic: 'item.changed', companyId });
    return { item, changed: true };
}
/**
 * Permanent delete is only for an item that never took part in anything.
 * With any history the item must be archived instead, so reports can still
 * explain what happened.
 */
async function deleteItemPermanently(itemId, actor, companyId) {
    const item = requireItem(itemId);
    const blockers = (0, item_master_js_1.deleteBlockers)(await referenceCounts(itemId));
    if (blockers.length) {
        throw new ItemMasterError(`"${item.code}" has history (${(0, item_master_js_1.describeBlockers)(blockers)}) and cannot be deleted. Archive it instead.`, 409, blockers);
    }
    if (persistence_js_1.databaseEnabled) {
        try {
            await db_js_1.prisma.$transaction([
                db_js_1.prisma.itemTag.deleteMany({ where: { itemId } }),
                db_js_1.prisma.customFieldValue.deleteMany({ where: { itemId } }),
                db_js_1.prisma.reorderRule.deleteMany({ where: { itemId } }),
                db_js_1.prisma.priceList.deleteMany({ where: { itemId } }),
                db_js_1.prisma.expiryAlert.deleteMany({ where: { itemId } }),
                db_js_1.prisma.replenishmentSuggestion.deleteMany({ where: { itemId } }),
                db_js_1.prisma.binStock.deleteMany({ where: { itemId } }),
                db_js_1.prisma.stockBalance.deleteMany({ where: { itemId } }),
                db_js_1.prisma.stockLedger.deleteMany({ where: { itemId } }),
                db_js_1.prisma.putawayTask.deleteMany({ where: { itemId } }),
                db_js_1.prisma.serialNumber.deleteMany({ where: { itemId } }),
                db_js_1.prisma.openingStockSnapshot.deleteMany({ where: { itemId } }),
                db_js_1.prisma.lot.deleteMany({ where: { itemId } }),
                db_js_1.prisma.item.delete({ where: { id: itemId } }),
            ]);
        }
        catch (error) {
            // A foreign key we did not anticipate means there is history after all.
            if (error.code === 'P2003') {
                throw new ItemMasterError(`"${item.code}" is still referenced elsewhere and cannot be deleted. Archive it instead.`, 409);
            }
            throw error;
        }
    }
    repository_js_1.items.splice(repository_js_1.items.findIndex((candidate) => candidate.id === itemId), 1);
    for (let index = repository_js_1.stockLedger.length - 1; index >= 0; index -= 1) {
        if (repository_js_1.stockLedger[index].itemId === itemId)
            repository_js_1.stockLedger.splice(index, 1);
    }
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'ITEM_DELETED',
        entityType: 'Item',
        entityId: itemId,
        metadata: { code: item.code, name: item.name },
    }));
    (0, event_bus_js_1.publishEvent)({ topic: 'item.changed', companyId });
}
