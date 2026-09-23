-- Blueprint v4 P6: supplier master, PO lifecycle stamps, exactly-once PO receipts, return refund status.
ALTER TABLE `Supplier` ADD COLUMN `contactName` VARCHAR(191) NULL, ADD COLUMN `leadTimeDays` INTEGER NULL,
  ADD COLUMN `moq` DOUBLE NULL, ADD COLUMN `paymentTerms` VARCHAR(191) NULL, ADD COLUMN `categories` TEXT NULL,
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE `PurchaseOrder` ADD COLUMN `approvedAt` DATETIME(3) NULL, ADD COLUMN `approvedById` VARCHAR(191) NULL,
  ADD COLUMN `sentAt` DATETIME(3) NULL, ADD COLUMN `closedAt` DATETIME(3) NULL, ADD COLUMN `closeNote` TEXT NULL;
ALTER TABLE `ReturnRequest` ADD COLUMN `refundStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING', ADD COLUMN `refundNote` TEXT NULL,
  ADD COLUMN `refundedAt` DATETIME(3) NULL, ADD COLUMN `refundedById` VARCHAR(191) NULL;
CREATE TABLE `PurchaseReceipt` (
  `id` VARCHAR(191) NOT NULL, `requestId` VARCHAR(191) NOT NULL, `purchaseOrderId` VARCHAR(191) NOT NULL,
  `receivedById` VARCHAR(191) NOT NULL, `result` JSON NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PurchaseReceipt_requestId_key`(`requestId`), INDEX `PurchaseReceipt_purchaseOrderId_idx`(`purchaseOrderId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
