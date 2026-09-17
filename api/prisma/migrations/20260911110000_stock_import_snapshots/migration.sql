-- Preserve fractional and negative ERP stock quantities exactly.
ALTER TABLE `StockLedger`
  MODIFY `onHand` DOUBLE NOT NULL DEFAULT 0,
  MODIFY `reserved` DOUBLE NOT NULL DEFAULT 0,
  MODIFY `inTransit` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `StockCount`
  MODIFY `physicalQty` DOUBLE NOT NULL,
  MODIFY `bookQty` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `Item`
  ADD COLUMN `subcategory` VARCHAR(191) NULL,
  ADD COLUMN `company` VARCHAR(191) NULL;

ALTER TABLE `Transfer`
  MODIFY `status` ENUM('DRAFT','PENDING_PICK','REQUESTED','PICKING','PARTIAL','PICKED','READY_FOR_ADMIN','CONFIRMED','DISPATCHED','IN_TRANSIT','RECEIVED','PARTIAL_RECEIVED','CLOSED','REJECTED','CANCELLED') NOT NULL DEFAULT 'REQUESTED';

ALTER TABLE `TransferLine`
  MODIFY `requestedQty` DOUBLE NOT NULL,
  MODIFY `pickedQty` DOUBLE NOT NULL DEFAULT 0,
  MODIFY `receivedQty` DOUBLE NOT NULL DEFAULT 0,
  MODIFY `damagedQty` DOUBLE NOT NULL DEFAULT 0;

CREATE TABLE `ImportBatch` (
  `id` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `fileName` VARCHAR(191) NOT NULL,
  `sourceFormat` VARCHAR(191) NOT NULL,
  `importedById` VARCHAR(191) NOT NULL,
  `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `totalRows` INTEGER NOT NULL,
  `validRows` INTEGER NOT NULL,
  `invalidRows` INTEGER NOT NULL,
  `duplicateRows` INTEGER NOT NULL DEFAULT 0,
  `metadata` JSON NULL,
  PRIMARY KEY (`id`),
  INDEX `ImportBatch_type_importedAt_idx` (`type`, `importedAt`),
  INDEX `ImportBatch_importedById_importedAt_idx` (`importedById`, `importedAt`),
  CONSTRAINT `ImportBatch_importedById_fkey` FOREIGN KEY (`importedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OpeningStockSnapshot` (
  `id` VARCHAR(191) NOT NULL,
  `importBatchId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `qty` DOUBLE NOT NULL,
  `snapshotAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `OpeningStockSnapshot_importBatchId_itemId_lotId_locationId_key` (`importBatchId`, `itemId`, `lotId`, `locationId`),
  INDEX `OpeningStockSnapshot_itemId_locationId_snapshotAt_idx` (`itemId`, `locationId`, `snapshotAt`),
  CONSTRAINT `OpeningStockSnapshot_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `ImportBatch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OpeningStockSnapshot_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OpeningStockSnapshot_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `Lot` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OpeningStockSnapshot_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
