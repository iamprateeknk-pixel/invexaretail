-- P2-P11: bin-level stock, routing signals, split fulfilment, marketplace connectors.

ALTER TABLE `Location`
  ADD COLUMN IF NOT EXISTS `latitude` DOUBLE NULL,
  ADD COLUMN IF NOT EXISTS `longitude` DOUBLE NULL,
  ADD COLUMN IF NOT EXISTS `deliverySlaHours` DOUBLE NULL,
  ADD COLUMN IF NOT EXISTS `shippingCostPerKm` DOUBLE NULL;

ALTER TABLE `OrderLine`
  ADD COLUMN IF NOT EXISTS `fulfillmentLocationId` VARCHAR(191) NULL;

ALTER TABLE `StockMovement`
  ADD COLUMN IF NOT EXISTS `binId` VARCHAR(191) NULL;

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
