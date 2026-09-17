-- Additive P5 transfer receipt migration. Safe for existing Hostinger MySQL data.
ALTER TABLE `TransferLine`
  ADD COLUMN IF NOT EXISTS `shortageQty` DOUBLE NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS `TransferReceipt` (
  `id` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(191) NOT NULL,
  `transferId` VARCHAR(191) NOT NULL,
  `receivedById` VARCHAR(191) NOT NULL,
  `status` VARCHAR(40) NOT NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `TransferReceipt_requestId_key` (`requestId`),
  KEY `TransferReceipt_transferId_createdAt_idx` (`transferId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `TransferReceiptLine` (
  `id` VARCHAR(191) NOT NULL,
  `receiptId` VARCHAR(191) NOT NULL,
  `transferLineId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NOT NULL,
  `receivedQty` DOUBLE NOT NULL DEFAULT 0,
  `damagedQty` DOUBLE NOT NULL DEFAULT 0,
  `shortageQty` DOUBLE NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `TransferReceiptLine_transferLineId_idx` (`transferLineId`),
  KEY `TransferReceiptLine_receiptId_idx` (`receiptId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
