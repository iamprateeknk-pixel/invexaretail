export declare const OPERATIONAL_TENANT_TABLES: readonly ["Lot", "StockLedger", "StockCount", "CountAssignment", "Transfer", "TransferLine", "TransferReceipt", "TransferReceiptLine", "TransferCarton", "InventoryMovement", "StockMovement", "StockBalance", "OpeningStockSnapshot", "PurchaseOrder", "PurchaseOrderLine", "Supplier", "ReorderRule", "SyncCheckpoint", "WebhookSubscription", "WebhookDeliveryLog", "ImportBatch", "ImportRow", "Order", "OrderLine", "AuditLog", "Bin", "PutawayTask", "PickWave", "ExpiryAlert", "ReplenishmentSuggestion", "ExceptionCase", "QcInspection", "AssetCheckout", "Job", "JobLine", "CompanyProfile", "SavedReport"];
/**
 * Applies the additive schema introduced by the Operations OS foundation.
 * Hostinger shared hosting has no reliable release/migration hook, so this
 * runs before hydration and never drops, truncates or rewrites business data.
 */
export declare function ensureFoundationSchema(): Promise<void>;
