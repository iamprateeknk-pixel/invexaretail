-- P4: explicit bin-to-bin transfer ledger (WMS 3.0 "Bin moves").

CREATE TABLE IF NOT EXISTS `BinMovement` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NOT NULL DEFAULT '',
  `locationId` VARCHAR(191) NOT NULL,
  `fromBinId` VARCHAR(191) NOT NULL,
  `toBinId` VARCHAR(191) NOT NULL,
  `quantity` DOUBLE NOT NULL,
  `reference` VARCHAR(191) NULL,
  `actorId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `BinMovement_locationId_createdAt_idx` (`locationId`, `createdAt`),
  INDEX `BinMovement_itemId_idx` (`itemId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
