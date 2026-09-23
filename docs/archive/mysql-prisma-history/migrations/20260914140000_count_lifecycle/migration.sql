-- Additive count review notes, recount parent, assignment due date and
-- priority. Hostinger databases may already have healed columns; guarded
-- ALTERs keep migrate deploy safe on both fresh and existing schemas.

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockCount' AND COLUMN_NAME = 'reviewReason');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `StockCount` ADD COLUMN `reviewReason` TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockCount' AND COLUMN_NAME = 'parentCountId');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `StockCount` ADD COLUMN `parentCountId` VARCHAR(191) NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CountAssignment' AND COLUMN_NAME = 'dueDate');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `CountAssignment` ADD COLUMN `dueDate` DATETIME(3) NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CountAssignment' AND COLUMN_NAME = 'priority');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `CountAssignment` ADD COLUMN `priority` VARCHAR(191) NOT NULL DEFAULT ''NORMAL''', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CountAssignment' AND COLUMN_NAME = 'parentCountId');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `CountAssignment` ADD COLUMN `parentCountId` VARCHAR(191) NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
