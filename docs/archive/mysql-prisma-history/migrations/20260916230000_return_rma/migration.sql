-- Returns/RMA: a formal customer-return/RMA/inspection flow, additive on
-- top of Order/OrderLine (never touches Order.status or the ledger
-- directly - see lib/returns-rma.ts for the status state machine).

CREATE TABLE IF NOT EXISTS `ReturnRequest` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
  `reason` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company',
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
  PRIMARY KEY (`id`),
  INDEX `ReturnRequest_orderId_status_idx` (`orderId`, `status`),
  INDEX `ReturnRequest_companyId_idx` (`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ReturnLine` (
  `id` VARCHAR(191) NOT NULL,
  `returnRequestId` VARCHAR(191) NOT NULL,
  `orderLineId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `quantity` DOUBLE NOT NULL,
  `disposition` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ReturnLine_returnRequestId_idx` (`returnRequestId`),
  INDEX `ReturnLine_orderLineId_idx` (`orderLineId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
