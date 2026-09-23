-- P5/P6: carrier adapter shipments (one row per booked AWB).

CREATE TABLE IF NOT EXISTS `Shipment` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `packSessionId` VARCHAR(191) NULL,
  `carrierProvider` VARCHAR(191) NOT NULL,
  `awbNumber` VARCHAR(191) NOT NULL,
  `serviceCode` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'BOOKED',
  `labelUrl` VARCHAR(191) NULL,
  `manifestId` VARCHAR(191) NULL,
  `weightKg` DOUBLE NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company',
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Shipment_awbNumber_key` (`awbNumber`),
  INDEX `Shipment_orderId_idx` (`orderId`),
  INDEX `Shipment_companyId_idx` (`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
