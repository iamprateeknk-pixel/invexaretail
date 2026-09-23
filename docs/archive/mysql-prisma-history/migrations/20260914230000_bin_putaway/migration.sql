-- Blueprint Module B / sections 6 & 8.3: warehouse zone/aisle/rack/bin
-- directory and putaway tasks (suggested vs confirmed bin).
CREATE TABLE `Bin` (
  `id` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `zone` VARCHAR(191) NULL,
  `aisle` VARCHAR(191) NULL,
  `rack` VARCHAR(191) NULL,
  `shelf` VARCHAR(191) NULL,
  `capacity` DOUBLE NULL,
  `storageClass` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Bin_locationId_code_key` (`locationId`, `code`),
  INDEX `Bin_locationId_status_idx` (`locationId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PutawayTask` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `quantity` DOUBLE NOT NULL,
  `suggestedBinId` VARCHAR(191) NULL,
  `confirmedBinId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `sourceDocument` VARCHAR(191) NULL,
  `sourceLineId` VARCHAR(191) NULL,
  `assignedToId` VARCHAR(191) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `PutawayTask_locationId_status_idx` (`locationId`, `status`),
  INDEX `PutawayTask_status_idx` (`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Bin` ADD CONSTRAINT `Bin_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PutawayTask` ADD CONSTRAINT `PutawayTask_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PutawayTask` ADD CONSTRAINT `PutawayTask_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `Lot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PutawayTask` ADD CONSTRAINT `PutawayTask_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PutawayTask` ADD CONSTRAINT `PutawayTask_suggestedBinId_fkey` FOREIGN KEY (`suggestedBinId`) REFERENCES `Bin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PutawayTask` ADD CONSTRAINT `PutawayTask_confirmedBinId_fkey` FOREIGN KEY (`confirmedBinId`) REFERENCES `Bin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PutawayTask` ADD CONSTRAINT `PutawayTask_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
