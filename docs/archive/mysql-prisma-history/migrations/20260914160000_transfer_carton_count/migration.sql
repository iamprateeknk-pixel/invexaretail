-- Additive carton count on Transfer. Hostinger databases may already have
-- notes from the original schema; guarded ALTER keeps migrate deploy safe.

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Transfer' AND COLUMN_NAME = 'cartonCount');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `Transfer` ADD COLUMN `cartonCount` INTEGER NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
