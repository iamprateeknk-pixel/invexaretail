-- P2-P11: bin-level stock, routing signals, split fulfilment, marketplace connectors.

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Location' AND COLUMN_NAME = 'latitude') = 0, 'ALTER TABLE `Location` ADD COLUMN `latitude` DOUBLE NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Location' AND COLUMN_NAME = 'longitude') = 0, 'ALTER TABLE `Location` ADD COLUMN `longitude` DOUBLE NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Location' AND COLUMN_NAME = 'deliverySlaHours') = 0, 'ALTER TABLE `Location` ADD COLUMN `deliverySlaHours` DOUBLE NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Location' AND COLUMN_NAME = 'shippingCostPerKm') = 0, 'ALTER TABLE `Location` ADD COLUMN `shippingCostPerKm` DOUBLE NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OrderLine' AND COLUMN_NAME = 'f') = 0, 'ALTER TABLE `OrderLine` ADD COLUMN `f` u', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OrderLine' AND COLUMN_NAME = 'V') = 0, 'ALTER TABLE `OrderLine` ADD COLUMN `V` A', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockMovement' AND COLUMN_NAME = 'b') = 0, 'ALTER TABLE `StockMovement` ADD COLUMN `b` i', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockMovement' AND COLUMN_NAME = 'V') = 0, 'ALTER TABLE `StockMovement` ADD COLUMN `V` A', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;


CREATE TABLE IF NOT EXISTS `BinStock` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NOT NULL DEFAULT '',
  `locationId` VARCHAR(191) NOT NULL,
  `binId` VARCHAR(191) NOT NULL,
  `onHand` DOUBLE NOT NULL DEFAULT 0,
  `reserved` DOUBLE NOT NULL DEFAULT 0,
  `version` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `BinStock_itemId_lotId_locationId_binId_key` (`itemId`, `lotId`, `locationId`, `binId`),
  INDEX `BinStock_locationId_binId_idx` (`locationId`, `binId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MarketplaceConnector` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `platform` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(191) NOT NULL,
  `webhookSecret` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'default-company',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastIngestedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `MarketplaceConnector_tenantId_status_idx` (`tenantId`, `status`),
  INDEX `MarketplaceConnector_platform_status_idx` (`platform`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
