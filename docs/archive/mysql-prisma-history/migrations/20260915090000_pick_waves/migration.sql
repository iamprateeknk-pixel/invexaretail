-- Blueprint Module C / section 9.2: pick waves group several
-- source-location transfers into one bin-sequenced pick pass.
CREATE TABLE `PickWave` (
  `id` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
  `transferIds` JSON NOT NULL,
  `assignedToId` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `PickWave_locationId_status_idx` (`locationId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PickWave` ADD CONSTRAINT `PickWave_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PickWave` ADD CONSTRAINT `PickWave_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PickWave` ADD CONSTRAINT `PickWave_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
