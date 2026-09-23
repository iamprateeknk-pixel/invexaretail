-- Folders/tags/views: saved smart folders/views (a re-runnable filter,
-- not a static folder of manually assigned items).

CREATE TABLE IF NOT EXISTS `SavedView` (
  `id` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `entityType` VARCHAR(191) NOT NULL DEFAULT 'ITEM',
  `filter` JSON NOT NULL,
  `isShared` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company',
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
  PRIMARY KEY (`id`),
  INDEX `SavedView_ownerId_updatedAt_idx` (`ownerId`, `updatedAt`),
  INDEX `SavedView_isShared_updatedAt_idx` (`isShared`, `updatedAt`),
  INDEX `SavedView_companyId_idx` (`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
