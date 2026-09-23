-- P3: true unit-serial tracking with a movement ledger (recall trace).

CREATE TABLE IF NOT EXISTS `SerialNumber` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NULL,
  `serial` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'IN_STOCK',
  `currentLocationId` VARCHAR(191) NULL,
  `currentBinId` VARCHAR(191) NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `soldAt` DATETIME(3) NULL,
  `returnState` VARCHAR(191) NULL,
  `warrantyEnd` DATETIME(3) NULL,
  `metadata` JSON NULL,
  `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company',
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SerialNumber_itemId_serial_key` (`itemId`, `serial`),
  INDEX `SerialNumber_currentLocationId_status_idx` (`currentLocationId`, `status`),
  INDEX `SerialNumber_companyId_idx` (`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SerialMovement` (
  `id` VARCHAR(191) NOT NULL,
  `serialNumberId` VARCHAR(191) NOT NULL,
  `movementType` VARCHAR(191) NOT NULL,
  `fromLocationId` VARCHAR(191) NULL,
  `toLocationId` VARCHAR(191) NULL,
  `fromStatus` VARCHAR(191) NULL,
  `toStatus` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NULL,
  `actorId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `SerialMovement_serialNumberId_createdAt_idx` (`serialNumberId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
