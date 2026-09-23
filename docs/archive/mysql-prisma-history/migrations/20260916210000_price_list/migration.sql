-- P9: retail pricing (MRP, retail, wholesale, institutional, web, marketplace,
-- branch, customer group, promotional price) with guardrails validation.

CREATE TABLE IF NOT EXISTS `PriceList` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `priceType` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NULL,
  `customerGroup` VARCHAR(191) NULL,
  `price` DOUBLE NOT NULL,
  `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `effectiveTo` DATETIME(3) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company',
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
  PRIMARY KEY (`id`),
  INDEX `PriceList_itemId_priceType_branchId_idx` (`itemId`, `priceType`, `branchId`),
  INDEX `PriceList_companyId_idx` (`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
