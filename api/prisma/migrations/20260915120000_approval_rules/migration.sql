-- Blueprint section 16.2: configurable, action-gating approval rules
-- (distinct from ToleranceRule, which only recommends).
CREATE TABLE `ApprovalRule` (
  `id` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `triggerType` VARCHAR(191) NOT NULL,
  `branchId` VARCHAR(191) NULL,
  `valueThreshold` DOUBLE NOT NULL,
  `requiredApproverRole` VARCHAR(191) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ApprovalRule_triggerType_active_idx` (`triggerType`, `active`),
  INDEX `ApprovalRule_branchId_active_idx` (`branchId`, `active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApprovalRequest` (
  `id` VARCHAR(191) NOT NULL,
  `ruleId` VARCHAR(191) NOT NULL,
  `triggerType` VARCHAR(191) NOT NULL,
  `entityType` VARCHAR(191) NOT NULL,
  `entityId` VARCHAR(191) NOT NULL,
  `valueAtStake` DOUBLE NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `requestedById` VARCHAR(191) NOT NULL,
  `decidedById` VARCHAR(191) NULL,
  `decidedAt` DATETIME(3) NULL,
  `decisionNotes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ApprovalRequest_entityType_entityId_status_idx` (`entityType`, `entityId`, `status`),
  INDEX `ApprovalRequest_status_triggerType_idx` (`status`, `triggerType`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ApprovalRule` ADD CONSTRAINT `ApprovalRule_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ApprovalRule` ADD CONSTRAINT `ApprovalRule_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `ApprovalRule`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
