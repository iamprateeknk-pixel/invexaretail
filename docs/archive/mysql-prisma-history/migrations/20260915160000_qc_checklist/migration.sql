-- Blueprint §8.2 (Quality Control): a formal, structured QC checklist
-- (seal/packaging/weight/moisture/expiry-window checks) replacing a
-- free-text ExceptionCase description. FK-free for the same
-- restricted-MySQL reason as the other rule/result tables in this app.
CREATE TABLE `QcChecklistTemplate` (
  `id` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NULL,
  `checks` JSON NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `QcChecklistTemplate_active_category_idx` (`active`, `category`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `QcInspection` (
  `id` VARCHAR(191) NOT NULL,
  `templateId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NULL,
  `lotId` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NULL,
  `sourceDocument` VARCHAR(191) NULL,
  `sourceLineId` VARCHAR(191) NULL,
  `results` JSON NOT NULL,
  `overallResult` VARCHAR(191) NOT NULL,
  `notes` TEXT NULL,
  `inspectedById` VARCHAR(191) NOT NULL,
  `exceptionCaseId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `QcInspection_sourceDocument_sourceLineId_idx` (`sourceDocument`, `sourceLineId`),
  INDEX `QcInspection_overallResult_createdAt_idx` (`overallResult`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QcChecklistTemplate` ADD CONSTRAINT `QcChecklistTemplate_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
