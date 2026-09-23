-- Additive Import Center staging. Hostinger databases may already have these
-- objects from ensureFoundationSchema(); CREATE TABLE / guarded ALTERs keep
-- migrate deploy safe on both fresh and healed schemas.

CREATE TABLE IF NOT EXISTS `ImportRow` (
  `id` VARCHAR(191) NOT NULL,
  `importBatchId` VARCHAR(191) NOT NULL,
  `rowNumber` INTEGER NOT NULL,
  `rawData` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `errors` JSON NULL,
  `warnings` JSON NULL,
  `mappedData` JSON NULL,
  `sourceKey` VARCHAR(191) NULL,
  `processedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ImportRow_importBatchId_rowNumber_key` (`importBatchId`, `rowNumber`),
  INDEX `ImportRow_importBatchId_status_idx` (`importBatchId`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ImportBatch' AND COLUMN_NAME = 'branchId');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `ImportBatch` ADD COLUMN `branchId` VARCHAR(191) NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ImportBatch' AND COLUMN_NAME = 'fileHash');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `ImportBatch` ADD COLUMN `fileHash` VARCHAR(191) NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ImportBatch' AND COLUMN_NAME = 'sourceDateFrom');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `ImportBatch` ADD COLUMN `sourceDateFrom` DATETIME(3) NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ImportBatch' AND COLUMN_NAME = 'sourceDateTo');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `ImportBatch` ADD COLUMN `sourceDateTo` DATETIME(3) NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ImportBatch' AND COLUMN_NAME = 'status');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `ImportBatch` ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT ''POSTED''', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ImportBatch' AND INDEX_NAME = 'ImportBatch_status_idx');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `ImportBatch` ADD INDEX `ImportBatch_status_idx` (`status`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ImportBatch' AND INDEX_NAME = 'ImportBatch_branchId_fileHash_idx');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `ImportBatch` ADD INDEX `ImportBatch_branchId_fileHash_idx` (`branchId`, `fileHash`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
