/*
  StockMovement is part of the stock accounting schema and is altered by the
  following bin-routing migration, but no earlier migration created it.
*/
CREATE TABLE `StockMovement` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `lotId` VARCHAR(191) NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `movementType` ENUM(
        'OPENING_STOCK',
        'PURCHASE_RECEIPT',
        'SALES_DEDUCTION',
        'SALES_RETURN',
        'TRANSFER_OUT',
        'TRANSFER_IN',
        'COUNT_VARIANCE',
        'ADJUSTMENT',
        'WASTE',
        'DAMAGE',
        'EXPIRY_WRITE_OFF'
    ) NOT NULL,
    `qtyDelta` DOUBLE NOT NULL,
    `beforeBalance` DOUBLE NOT NULL,
    `afterBalance` DOUBLE NOT NULL,
    `sourceDocument` VARCHAR(191) NULL,
    `sourceLineId` VARCHAR(191) NULL,
    `actor` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NOT NULL,
    `correlationId` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `metadata` JSON NULL,
    `posted` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',

    INDEX `StockMovement_tenantId_idx`(`tenantId`),
    INDEX `StockMovement_itemId_locationId_timestamp_idx`(`itemId`, `locationId`, `timestamp`),
    INDEX `StockMovement_correlationId_idx`(`correlationId`),
    INDEX `StockMovement_sourceDocument_sourceLineId_idx`(`sourceDocument`, `sourceLineId`),
    INDEX `StockMovement_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StockMovement`
    ADD CONSTRAINT `StockMovement_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockMovement`
    ADD CONSTRAINT `StockMovement_lotId_fkey`
    FOREIGN KEY (`lotId`) REFERENCES `Lot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `StockMovement`
    ADD CONSTRAINT `StockMovement_locationId_fkey`
    FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
