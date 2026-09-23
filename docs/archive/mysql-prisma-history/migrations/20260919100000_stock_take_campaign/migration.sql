-- Blueprint v4 §12 / Appendix A: monthly stock-take campaign (auto daily
-- allocation, rollover, recount, coverage tracking). FK-free for the same
-- restricted-MySQL reason as the other rule/result tables in this app.
CREATE TABLE IF NOT EXISTS `StockTakeCampaign` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company',
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
  `name` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `dailyItemsPerUser` INTEGER NOT NULL,
  `userIds` JSON NOT NULL,
  `priorityOrder` JSON NOT NULL,
  `includeNewStock` BOOLEAN NOT NULL DEFAULT true,
  `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Kolkata',
  `startDate` VARCHAR(191) NOT NULL,
  `endDate` VARCHAR(191) NULL,
  `lastRunDate` VARCHAR(191) NULL,
  `pausedFrom` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `activatedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `StockTakeCampaign_companyId_locationId_status_idx` (`companyId`, `locationId`, `status`),
  INDEX `StockTakeCampaign_tenantId_idx` (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `StockTakeCampaignItem` (
  `campaignId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `excludedReason` VARCHAR(191) NULL,
  `assignedToId` VARCHAR(191) NULL,
  `assignmentId` VARCHAR(191) NULL,
  `countId` VARCHAR(191) NULL,
  `assignedDate` DATETIME(3) NULL,
  `lastCountedAt` DATETIME(3) NULL,
  `recounts` INTEGER NOT NULL DEFAULT 0,
  `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`campaignId`, `itemId`),
  INDEX `StockTakeCampaignItem_campaignId_status_idx` (`campaignId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CountAssignment`
  ADD COLUMN `campaignId` VARCHAR(191) NULL,
  ADD INDEX `CountAssignment_campaignId_idx` (`campaignId`);
