-- Blueprint Module D / section 10.2: configurable count tolerance rules.
CREATE TABLE `ToleranceRule` (
  `id` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NULL,
  `branchId` VARCHAR(191) NULL,
  `valueThreshold` DOUBLE NULL,
  `percentThreshold` DOUBLE NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ToleranceRule_active_category_idx` (`active`, `category`),
  INDEX `ToleranceRule_branchId_active_idx` (`branchId`, `active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ToleranceRule` ADD CONSTRAINT `ToleranceRule_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ToleranceRule` ADD CONSTRAINT `ToleranceRule_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
