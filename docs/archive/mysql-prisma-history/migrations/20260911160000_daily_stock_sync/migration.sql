ALTER TABLE `User`
  MODIFY `role` ENUM('ADMIN','ADMIN_USER','STORE_USER','WAREHOUSE_PICKER','AUDITOR') NOT NULL;

CREATE TABLE IF NOT EXISTS `InventoryMovement` (
  `id` VARCHAR(191) NOT NULL,
  `dedupeKey` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `movementType` VARCHAR(191) NOT NULL,
  `qtyDelta` DOUBLE NOT NULL,
  `transactionAt` DATETIME(3) NOT NULL,
  `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sourceType` VARCHAR(191) NOT NULL,
  `sourceReference` VARCHAR(191) NOT NULL,
  `importBatchId` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `metadata` JSON NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `InventoryMovement_dedupeKey_key` (`dedupeKey`),
  INDEX `InventoryMovement_locationId_transactionAt_idx` (`locationId`, `transactionAt`),
  INDEX `InventoryMovement_itemId_locationId_transactionAt_idx` (`itemId`, `locationId`, `transactionAt`),
  INDEX `InventoryMovement_sourceType_sourceReference_idx` (`sourceType`, `sourceReference`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SyncCheckpoint` (
  `id` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(191) NOT NULL,
  `syncedThroughAt` DATETIME(3) NOT NULL,
  `lastImportBatchId` VARCHAR(191) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SyncCheckpoint_locationId_sourceType_key` (`locationId`, `sourceType`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
