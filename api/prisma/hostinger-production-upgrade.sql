-- Invexa Retail Hostinger production upgrade
-- Generated 2026-09-11
-- Additive DDL only: creates new feature tables without deleting existing data.
-- Take a phpMyAdmin export backup before importing this file.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS `Tag` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `color` VARCHAR(191) NOT NULL DEFAULT 'emerald',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Tag_name_key` (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ItemTag` (
  `itemId` VARCHAR(191) NOT NULL,
  `tagId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`itemId`, `tagId`),
  INDEX `ItemTag_tagId_idx` (`tagId`),
  CONSTRAINT `ItemTag_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ItemTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `CustomFieldDefinition` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL DEFAULT 'text',
  `options` JSON NULL,
  `required` BOOLEAN NOT NULL DEFAULT false,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CustomFieldDefinition_name_key` (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `CustomFieldValue` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `fieldId` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CustomFieldValue_itemId_fieldId_key` (`itemId`, `fieldId`),
  INDEX `CustomFieldValue_fieldId_idx` (`fieldId`),
  CONSTRAINT `CustomFieldValue_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CustomFieldValue_fieldId_fkey` FOREIGN KEY (`fieldId`) REFERENCES `CustomFieldDefinition` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Supplier` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NULL,
  `phone` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PurchaseOrder` (
  `id` VARCHAR(191) NOT NULL,
  `number` VARCHAR(191) NOT NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `expectedAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `totalAmount` DOUBLE NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PurchaseOrder_number_key` (`number`),
  INDEX `PurchaseOrder_locationId_status_idx` (`locationId`, `status`),
  INDEX `PurchaseOrder_supplierId_idx` (`supplierId`),
  CONSTRAINT `PurchaseOrder_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PurchaseOrderLine` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `receivedQty` INTEGER NOT NULL DEFAULT 0,
  `unitCost` DOUBLE NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `PurchaseOrderLine_purchaseOrderId_idx` (`purchaseOrderId`),
  INDEX `PurchaseOrderLine_itemId_idx` (`itemId`),
  CONSTRAINT `PurchaseOrderLine_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PurchaseOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `ReorderRule` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `minQty` INTEGER NOT NULL DEFAULT 0,
  `targetQty` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ReorderRule_itemId_locationId_key` (`itemId`, `locationId`),
  INDEX `ReorderRule_locationId_idx` (`locationId`),
  CONSTRAINT `ReorderRule_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SavedReport` (
  `id` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `reportType` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NULL,
  `config` JSON NULL,
  `isShared` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `SavedReport_ownerId_updatedAt_idx` (`ownerId`, `updatedAt`),
  INDEX `SavedReport_isShared_updatedAt_idx` (`isShared`, `updatedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `AssetCheckout` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `assigneeName` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(191) NOT NULL DEFAULT 'CHECKED_OUT',
  `dueAt` DATETIME(3) NULL,
  `conditionOut` TEXT NULL,
  `conditionIn` TEXT NULL,
  `checkedOutAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `returnedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `AssetCheckout_locationId_status_idx` (`locationId`, `status`),
  INDEX `AssetCheckout_itemId_status_idx` (`itemId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Job` (
  `id` VARCHAR(191) NOT NULL,
  `number` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `dueAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Job_number_key` (`number`),
  INDEX `Job_locationId_status_idx` (`locationId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `JobLine` (
  `id` VARCHAR(191) NOT NULL,
  `jobId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `plannedQty` INTEGER NOT NULL,
  `issuedQty` INTEGER NOT NULL DEFAULT 0,
  `usedQty` INTEGER NOT NULL DEFAULT 0,
  `returnedQty` INTEGER NOT NULL DEFAULT 0,
  `damagedQty` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `JobLine_jobId_idx` (`jobId`),
  INDEX `JobLine_itemId_idx` (`itemId`),
  CONSTRAINT `JobLine_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ContextComment` (
  `id` VARCHAR(191) NOT NULL,
  `entityType` VARCHAR(191) NOT NULL,
  `entityId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `authorName` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `mentions` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ContextComment_entityType_entityId_createdAt_idx` (`entityType`, `entityId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `UserNotification` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NULL,
  `role` VARCHAR(191) NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `type` VARCHAR(191) NOT NULL DEFAULT 'info',
  `readAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `UserNotification_userId_readAt_createdAt_idx` (`userId`, `readAt`, `createdAt`),
  INDEX `UserNotification_role_readAt_createdAt_idx` (`role`, `readAt`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `WebhookSubscription` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `endpointUrl` TEXT NOT NULL,
  `events` JSON NOT NULL,
  `secretHash` VARCHAR(191) NOT NULL,
  `secretEncrypted` TEXT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `WebhookSubscription_status_createdAt_idx` (`status`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WebhookDeliveryLog` (
  `id` VARCHAR(191) NOT NULL,
  `subscriptionId` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(191) NOT NULL,
  `entityId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `attemptCount` INTEGER NOT NULL DEFAULT 0,
  `responseCode` INTEGER NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deliveredAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `WebhookDeliveryLog_subscriptionId_createdAt_idx` (`subscriptionId`, `createdAt`),
  INDEX `WebhookDeliveryLog_status_createdAt_idx` (`status`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Daily stock sync and immutable import history. These tables intentionally
-- avoid foreign keys so the script works with restricted Hostinger MySQL users.
CREATE TABLE IF NOT EXISTS `ImportBatch` (
  `id` VARCHAR(191) NOT NULL, `type` VARCHAR(191) NOT NULL,
  `fileName` VARCHAR(191) NOT NULL, `sourceFormat` VARCHAR(191) NOT NULL,
  `importedById` VARCHAR(191) NOT NULL,
  `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `totalRows` INTEGER NOT NULL, `validRows` INTEGER NOT NULL,
  `invalidRows` INTEGER NOT NULL, `duplicateRows` INTEGER NOT NULL DEFAULT 0,
  `metadata` JSON NULL, PRIMARY KEY (`id`),
  INDEX `ImportBatch_type_importedAt_idx` (`type`, `importedAt`),
  INDEX `ImportBatch_importedById_importedAt_idx` (`importedById`, `importedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `InventoryMovement` (
  `id` VARCHAR(191) NOT NULL, `dedupeKey` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL, `lotId` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NOT NULL, `movementType` VARCHAR(191) NOT NULL,
  `qtyDelta` DOUBLE NOT NULL, `transactionAt` DATETIME(3) NOT NULL,
  `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sourceType` VARCHAR(191) NOT NULL, `sourceReference` VARCHAR(191) NOT NULL,
  `importBatchId` VARCHAR(191) NULL, `createdById` VARCHAR(191) NOT NULL,
  `metadata` JSON NULL, PRIMARY KEY (`id`),
  UNIQUE INDEX `InventoryMovement_dedupeKey_key` (`dedupeKey`),
  INDEX `InventoryMovement_locationId_transactionAt_idx` (`locationId`, `transactionAt`),
  INDEX `InventoryMovement_itemId_locationId_transactionAt_idx` (`itemId`, `locationId`, `transactionAt`),
  INDEX `InventoryMovement_sourceType_sourceReference_idx` (`sourceType`, `sourceReference`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SyncCheckpoint` (
  `id` VARCHAR(191) NOT NULL, `locationId` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(191) NOT NULL, `syncedThroughAt` DATETIME(3) NOT NULL,
  `lastImportBatchId` VARCHAR(191) NULL, `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SyncCheckpoint_locationId_sourceType_key` (`locationId`, `sourceType`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `OpeningStockSnapshot` (
  `id` VARCHAR(191) NOT NULL, `importBatchId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL, `lotId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL, `qty` DOUBLE NOT NULL,
  `snapshotAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `OpeningStockSnapshot_importBatchId_itemId_lotId_locationId_key` (`importBatchId`, `itemId`, `lotId`, `locationId`),
  INDEX `OpeningStockSnapshot_locationId_snapshotAt_idx` (`locationId`, `snapshotAt`),
  INDEX `OpeningStockSnapshot_itemId_locationId_idx` (`itemId`, `locationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Industry packs: catalog key on the single-tenant company profile.
SET @industry_key_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CompanyProfile' AND COLUMN_NAME = 'industryKey'
);
SET @industry_key_sql := IF(@industry_key_exists = 0,
  'ALTER TABLE `CompanyProfile` ADD COLUMN `industryKey` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE industry_key_stmt FROM @industry_key_sql;
EXECUTE industry_key_stmt;
DEALLOCATE PREPARE industry_key_stmt;

SET @webhook_secret_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'WebhookSubscription' AND COLUMN_NAME = 'secretEncrypted'
);
SET @webhook_secret_sql := IF(@webhook_secret_exists = 0,
  'ALTER TABLE `WebhookSubscription` ADD COLUMN `secretEncrypted` TEXT NULL',
  'SELECT 1');
PREPARE webhook_secret_stmt FROM @webhook_secret_sql;
EXECUTE webhook_secret_stmt;
DEALLOCATE PREPARE webhook_secret_stmt;


