CREATE TABLE IF NOT EXISTS `AssetCheckout` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `assigneeName` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(191) NOT NULL DEFAULT 'CHECKED_OUT',
  `dueAt` DATETIME(3) NULL,
  `conditionOut` TEXT NULL,
  `conditionIn` TEXT NULL,
  `checkedOutAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `returnedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `AssetCheckout_locationId_status_idx` (`locationId`, `status`),
  INDEX `AssetCheckout_itemId_status_idx` (`itemId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Job` (
  `id` VARCHAR(191) NOT NULL,
  `number` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `dueAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Job_number_key` (`number`),
  INDEX `Job_locationId_status_idx` (`locationId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `JobLine` (
  `id` VARCHAR(191) NOT NULL,
  `jobId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `plannedQty` INTEGER NOT NULL,
  `issuedQty` INTEGER NOT NULL DEFAULT 0,
  `usedQty` INTEGER NOT NULL DEFAULT 0,
  `returnedQty` INTEGER NOT NULL DEFAULT 0,
  `damagedQty` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `JobLine_jobId_idx` (`jobId`),
  INDEX `JobLine_itemId_idx` (`itemId`),
  CONSTRAINT `JobLine_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ContextComment` (
  `id` VARCHAR(191) NOT NULL,
  `entityType` VARCHAR(191) NOT NULL,
  `entityId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `authorName` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `mentions` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ContextComment_entityType_entityId_createdAt_idx` (`entityType`, `entityId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `UserNotification` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NULL,
  `role` VARCHAR(191) NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `type` VARCHAR(191) NOT NULL DEFAULT 'info',
  `readAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `UserNotification_userId_readAt_createdAt_idx` (`userId`, `readAt`, `createdAt`),
  INDEX `UserNotification_role_readAt_createdAt_idx` (`role`, `readAt`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
