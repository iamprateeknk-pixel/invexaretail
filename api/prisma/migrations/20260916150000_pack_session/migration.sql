-- P5: packing station (scan -> verify -> cartonize -> weight/dims -> seal).

CREATE TABLE IF NOT EXISTS `PackSession` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'IN_PROGRESS',
  `cartonCount` INTEGER NULL,
  `weightKg` DOUBLE NULL,
  `lengthCm` DOUBLE NULL,
  `widthCm` DOUBLE NULL,
  `heightCm` DOUBLE NULL,
  `packedById` VARCHAR(191) NOT NULL,
  `sealedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company',
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
  PRIMARY KEY (`id`),
  INDEX `PackSession_orderId_status_idx` (`orderId`, `status`),
  INDEX `PackSession_companyId_idx` (`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PackedLine` (
  `id` VARCHAR(191) NOT NULL,
  `packSessionId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NULL,
  `quantity` DOUBLE NOT NULL,
  `scannedById` VARCHAR(191) NOT NULL,
  `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `PackedLine_packSessionId_idx` (`packSessionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
