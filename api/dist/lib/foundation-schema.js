"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPERATIONAL_TENANT_TABLES = void 0;
exports.ensureFoundationSchema = ensureFoundationSchema;
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
 * ADR-003: every table this constant lists is a Prisma model. Schema
 * evolution runs exclusively through `prisma migrate deploy` (see
 * render.yaml's preDeployCommand and docker-compose's api entrypoint);
 * runtime ALTER/CREATE DDL is a prohibited pattern (AGENTS.md). This used to
 * hand-run additive MySQL DDL because Hostinger shared hosting exposed no
 * migration hook - Postgres with a real deploy pipeline has one, so this is
 * now a no-op kept only so existing call sites do not need to change.
 */
async function ensureFoundationSchema() { }
