/*
  CountAssignment was present in the Prisma schema but was missing from the
  original init migration.  Keep this migration before count_lifecycle so a
  fresh or partially migrated MySQL database can apply the lifecycle ALTERs.
*/
CREATE TABLE `CountAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `assignedToId` VARCHAR(191) NOT NULL,
    `assignedById` VARCHAR(191) NOT NULL,
    `countDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NULL,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
    `instructions` TEXT NULL,
    `status` ENUM('ASSIGNED', 'SUBMITTED', 'CANCELLED') NOT NULL DEFAULT 'ASSIGNED',
    `countId` VARCHAR(191) NULL,
    `parentCountId` VARCHAR(191) NULL,
    `campaignId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',

    UNIQUE INDEX `CountAssignment_countId_key`(`countId`),
    INDEX `CountAssignment_tenantId_idx`(`tenantId`),
    INDEX `CountAssignment_campaignId_idx`(`campaignId`),
    INDEX `CountAssignment_assignedToId_status_idx`(`assignedToId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CountAssignment`
  ADD CONSTRAINT `CountAssignment_locationId_fkey`
  FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CountAssignment`
  ADD CONSTRAINT `CountAssignment_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CountAssignment`
  ADD CONSTRAINT `CountAssignment_assignedToId_fkey`
  FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CountAssignment`
  ADD CONSTRAINT `CountAssignment_assignedById_fkey`
  FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CountAssignment`
  ADD CONSTRAINT `CountAssignment_countId_fkey`
  FOREIGN KEY (`countId`) REFERENCES `StockCount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
