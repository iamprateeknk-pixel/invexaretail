-- Blueprint section 16.2, third named workflow example: "damaged receipt >
-- threshold -> photo mandatory." Gates on evidence that must already exist
-- (distinct from ToleranceRule, which only recommends, and ApprovalRule,
-- which gates on a human decision).
CREATE TABLE `EvidenceRule` (
  `id` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `triggerType` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NULL,
  `branchId` VARCHAR(191) NULL,
  `quantityThreshold` DOUBLE NULL,
  `valueThreshold` DOUBLE NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `EvidenceRule_triggerType_active_idx` (`triggerType`, `active`),
  INDEX `EvidenceRule_branchId_active_idx` (`branchId`, `active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EvidenceRule` ADD CONSTRAINT `EvidenceRule_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `EvidenceRule` ADD CONSTRAINT `EvidenceRule_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
