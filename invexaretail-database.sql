-- InvexaRetail - complete database setup
-- Schema generated from prisma/schema.prisma; seed data matches prisma/seed.ts.
--
-- WARNING: this DROPs the existing tables. Everything currently stored is lost.
-- Import it into a fresh database, or take a backup first.
--
-- Demo password for all four accounts: ChangeMe123!

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `AuditLog`, `TransferLine`, `Transfer`, `CountAssignment`, `StockCount`, `StockLedger`, `Lot`, `Item`, `Location`, `User`;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR') NOT NULL,
    `assignedLocations` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Location` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Location_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Item` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Item_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lot` (
    `id` VARCHAR(191) NOT NULL,
    `lotNo` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `expiryDate` DATETIME(3) NULL,
    `attributes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Lot_itemId_lotNo_key`(`itemId`, `lotNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLedger` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `lotId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `onHand` INTEGER NOT NULL DEFAULT 0,
    `reserved` INTEGER NOT NULL DEFAULT 0,
    `inTransit` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,
    `lastUpdatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockLedger_itemId_lotId_locationId_key`(`itemId`, `lotId`, `locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockCount` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `lotId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `physicalQty` INTEGER NOT NULL,
    `bookQty` INTEGER NOT NULL DEFAULT 0,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `submittedById` VARCHAR(191) NOT NULL,
    `countDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `reviewStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING_REVIEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CountAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `assignedToId` VARCHAR(191) NOT NULL,
    `assignedById` VARCHAR(191) NOT NULL,
    `countDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `instructions` TEXT NULL,
    `status` ENUM('ASSIGNED', 'SUBMITTED', 'CANCELLED') NOT NULL DEFAULT 'ASSIGNED',
    `countId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CountAssignment_countId_key`(`countId`),
    INDEX `CountAssignment_assignedToId_status_idx`(`assignedToId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transfer` (
    `id` VARCHAR(191) NOT NULL,
    `sourceLocationId` VARCHAR(191) NOT NULL,
    `destinationLocationId` VARCHAR(191) NOT NULL,
    `status` ENUM('REQUESTED', 'PICKED', 'DISPATCHED', 'RECEIVED', 'CLOSED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `requestedById` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TransferLine` (
    `id` VARCHAR(191) NOT NULL,
    `transferId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `lotId` VARCHAR(191) NOT NULL,
    `requestedQty` INTEGER NOT NULL,
    `pickedQty` INTEGER NOT NULL DEFAULT 0,
    `receivedQty` INTEGER NOT NULL DEFAULT 0,
    `damagedQty` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `actorRole` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Lot` ADD CONSTRAINT `Lot_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockLedger` ADD CONSTRAINT `StockLedger_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockLedger` ADD CONSTRAINT `StockLedger_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `Lot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockLedger` ADD CONSTRAINT `StockLedger_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCount` ADD CONSTRAINT `StockCount_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCount` ADD CONSTRAINT `StockCount_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `Lot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCount` ADD CONSTRAINT `StockCount_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockCount` ADD CONSTRAINT `StockCount_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CountAssignment` ADD CONSTRAINT `CountAssignment_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CountAssignment` ADD CONSTRAINT `CountAssignment_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CountAssignment` ADD CONSTRAINT `CountAssignment_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CountAssignment` ADD CONSTRAINT `CountAssignment_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transfer` ADD CONSTRAINT `Transfer_sourceLocationId_fkey` FOREIGN KEY (`sourceLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transfer` ADD CONSTRAINT `Transfer_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransferLine` ADD CONSTRAINT `TransferLine_transferId_fkey` FOREIGN KEY (`transferId`) REFERENCES `Transfer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransferLine` ADD CONSTRAINT `TransferLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransferLine` ADD CONSTRAINT `TransferLine_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `Lot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed data

INSERT INTO `User` (`id`,`name`,`email`,`passwordHash`,`role`,`assignedLocations`,`createdAt`,`updatedAt`) VALUES
  ('user-admin-1','Admin User','admin@retail.local','$2b$12$UCxuZ6YKzgJlHWSAD/vtVuzjUxiSZwlWNWbCygPxJFrOHxmgLJisO','ADMIN','["loc-1","loc-2","wh-1"]','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('user-store-1','Store User','store@retail.local','$2b$12$UCxuZ6YKzgJlHWSAD/vtVuzjUxiSZwlWNWbCygPxJFrOHxmgLJisO','STORE_USER','["loc-1"]','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('user-picker-1','Warehouse Picker','picker@retail.local','$2b$12$UCxuZ6YKzgJlHWSAD/vtVuzjUxiSZwlWNWbCygPxJFrOHxmgLJisO','WAREHOUSE_PICKER','["wh-1"]','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('user-auditor-1','Auditor User','auditor@retail.local','$2b$12$UCxuZ6YKzgJlHWSAD/vtVuzjUxiSZwlWNWbCygPxJFrOHxmgLJisO','AUDITOR','["loc-1"]','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000');

INSERT INTO `Location` (`id`,`code`,`name`,`type`,`parentId`,`createdAt`,`updatedAt`) VALUES
  ('loc-1','MAIN-STORE','Main Store','store',NULL,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('loc-2','BRANCH-STORE','Branch Store','store',NULL,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('wh-1','CENTRAL-WH','Warehouse','warehouse',NULL,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000');

INSERT INTO `Item` (`id`,`code`,`name`,`category`,`unit`,`description`,`createdAt`,`updatedAt`) VALUES
  ('item-1001','SKU-1001','Rice 5kg','Staples','bag',NULL,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('item-1002','SKU-1002','Milk 1L','Dairy','pack',NULL,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('item-1003','SKU-1003','Soap 200g','Household','box',NULL,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000');

INSERT INTO `Lot` (`id`,`lotNo`,`itemId`,`expiryDate`,`attributes`,`createdAt`,`updatedAt`) VALUES
  ('lot-1001','LOT-01','item-1001','2027-12-31 00:00:00.000','{"source":"seed"}','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('lot-1002','LOT-02','item-1002','2026-12-15 00:00:00.000','{"source":"seed"}','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('lot-1003','LOT-03','item-1003','2027-03-15 00:00:00.000','{"source":"seed"}','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000');

INSERT INTO `StockLedger` (`id`,`itemId`,`lotId`,`locationId`,`onHand`,`reserved`,`inTransit`,`version`,`lastUpdatedAt`) VALUES
  ('stk-1','item-1001','lot-1001','loc-1',28,0,0,0,'2026-01-01 00:00:00.000'),
  ('stk-2','item-1001','lot-1001','wh-1',40,0,0,0,'2026-01-01 00:00:00.000'),
  ('stk-3','item-1002','lot-1002','loc-1',26,0,0,0,'2026-01-01 00:00:00.000'),
  ('stk-4','item-1002','lot-1002','loc-2',26,0,0,0,'2026-01-01 00:00:00.000'),
  ('stk-5','item-1003','lot-1003','wh-1',80,0,0,0,'2026-01-01 00:00:00.000');

INSERT INTO `StockCount` (`id`,`itemId`,`lotId`,`locationId`,`physicalQty`,`bookQty`,`mode`,`submittedById`,`countDate`,`approvedById`,`approvedAt`,`reviewStatus`,`createdAt`,`updatedAt`) VALUES
  ('count-1','item-1001','lot-1001','loc-1',28,28,'scan','user-store-1','2026-01-01 00:00:00.000',NULL,NULL,'PENDING_REVIEW','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('count-2','item-1002','lot-1002','loc-2',26,26,'manual','user-store-1','2026-01-01 00:00:00.000',NULL,NULL,'PENDING_REVIEW','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000');

INSERT INTO `Transfer` (`id`,`sourceLocationId`,`destinationLocationId`,`status`,`requestedById`,`notes`,`createdAt`,`updatedAt`) VALUES
  ('transfer-1','loc-1','wh-1','REQUESTED','user-admin-1',NULL,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('transfer-2','wh-1','loc-2','DISPATCHED','user-admin-1',NULL,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000');

INSERT INTO `TransferLine` (`id`,`transferId`,`itemId`,`lotId`,`requestedQty`,`pickedQty`,`receivedQty`,`damagedQty`,`createdAt`,`updatedAt`) VALUES
  ('tline-1','transfer-1','item-1001','lot-1001',12,0,0,0,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000'),
  ('tline-2','transfer-2','item-1003','lot-1003',18,0,0,0,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000');

SET FOREIGN_KEY_CHECKS = 1;
