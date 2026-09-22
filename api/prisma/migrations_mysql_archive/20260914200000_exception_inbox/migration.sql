-- Blueprint Module H / section 18: Exception Inbox.
-- Cross-module case queue for damage, short/excess receipt, wrong item,
-- expired stock, missing stock (count variance), QC failure and transfer
-- discrepancy exceptions.
CREATE TABLE `ExceptionCase` (
  `id` VARCHAR(191) NOT NULL,
  `type` ENUM('DAMAGE','SHORT_RECEIPT','EXCESS_RECEIPT','WRONG_ITEM','EXPIRED','MISSING_STOCK','QC_FAIL','TRANSFER_DISCREPANCY','COUNT_VARIANCE','QUARANTINE') NOT NULL,
  `status` ENUM('OPEN','IN_PROGRESS','PENDING_APPROVAL','RESOLVED','CLOSED','REJECTED') NOT NULL DEFAULT 'OPEN',
  `priority` ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `itemId` VARCHAR(191) NULL,
  `lotId` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NULL,
  `branchId` VARCHAR(191) NULL,
  `quantity` DOUBLE NULL,
  `valueAtRisk` DOUBLE NULL,
  `sourceDocument` VARCHAR(191) NULL,
  `sourceLineId` VARCHAR(191) NULL,
  `ownerId` VARCHAR(191) NULL,
  `reportedById` VARCHAR(191) NOT NULL,
  `dueAt` DATETIME(3) NULL,
  `disposition` ENUM('RESTOCK','VENDOR_RETURN','MARKDOWN','DESTROY','REWORK','WRITE_OFF','ACCEPT','RECOUNT','ESCALATE','NONE') NULL,
  `resolutionNotes` TEXT NULL,
  `resolvedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ExceptionCase_status_priority_dueAt_idx` (`status`, `priority`, `dueAt`),
  INDEX `ExceptionCase_type_status_idx` (`type`, `status`),
  INDEX `ExceptionCase_ownerId_status_idx` (`ownerId`, `status`),
  INDEX `ExceptionCase_locationId_status_idx` (`locationId`, `status`),
  INDEX `ExceptionCase_sourceDocument_sourceLineId_idx` (`sourceDocument`, `sourceLineId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ExceptionCase` ADD CONSTRAINT `ExceptionCase_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ExceptionCase` ADD CONSTRAINT `ExceptionCase_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `Lot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ExceptionCase` ADD CONSTRAINT `ExceptionCase_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ExceptionCase` ADD CONSTRAINT `ExceptionCase_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ExceptionCase` ADD CONSTRAINT `ExceptionCase_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ExceptionCase` ADD CONSTRAINT `ExceptionCase_reportedById_fkey` FOREIGN KEY (`reportedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
