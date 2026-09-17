-- Blueprint Module G / section 13.3: minimal OMS Order + ATP starter.
CREATE TABLE `Order` (
  `id` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(191) NOT NULL,
  `externalReference` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `fulfillmentLocationId` VARCHAR(191) NOT NULL,
  `customerName` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `reservedAt` DATETIME(3) NULL,
  `fulfilledAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `Order_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `Order_channel_status_idx` (`channel`, `status`),
  INDEX `Order_fulfillmentLocationId_status_idx` (`fulfillmentLocationId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderLine` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NULL,
  `requestedQty` DOUBLE NOT NULL,
  `fulfilledQty` DOUBLE NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `OrderLine_orderId_idx` (`orderId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Order` ADD CONSTRAINT `Order_fulfillmentLocationId_fkey` FOREIGN KEY (`fulfillmentLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Order` ADD CONSTRAINT `Order_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OrderLine` ADD CONSTRAINT `OrderLine_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OrderLine` ADD CONSTRAINT `OrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OrderLine` ADD CONSTRAINT `OrderLine_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `Lot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
