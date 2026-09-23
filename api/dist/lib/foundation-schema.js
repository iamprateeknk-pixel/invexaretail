"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPERATIONAL_TENANT_TABLES = void 0;
exports.ensureFoundationSchema = ensureFoundationSchema;
/**
 * Tables whose business data must always carry a tenant boundary.
 * The PostgreSQL schema is managed exclusively by Prisma migrations.
 */
exports.OPERATIONAL_TENANT_TABLES = [
    'Lot', 'StockLedger', 'StockCount', 'CountAssignment', 'Transfer', 'TransferLine',
    'TransferReceipt', 'TransferReceiptLine', 'TransferCarton', 'InventoryMovement',
    'StockMovement', 'StockBalance', 'OpeningStockSnapshot', 'PurchaseOrder',
    'PurchaseOrderLine', 'Supplier', 'ReorderRule', 'SyncCheckpoint',
    'WebhookSubscription', 'WebhookDeliveryLog', 'ImportBatch', 'ImportRow',
    'Order', 'OrderLine', 'AuditLog', 'Bin', 'PutawayTask', 'PickWave',
    'ExpiryAlert', 'ReplenishmentSuggestion', 'ExceptionCase', 'QcInspection',
    'AssetCheckout', 'Job', 'JobLine', 'CompanyProfile', 'SavedReport',
];
/**
 * Kept as a compatibility boundary for startup callers. Runtime DDL is
 * intentionally forbidden; Prisma migrate deploy owns the schema.
 */
async function ensureFoundationSchema() {
    return;
}
