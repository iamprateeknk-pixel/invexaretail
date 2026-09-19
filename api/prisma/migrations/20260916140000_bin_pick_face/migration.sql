-- P4: pick-face vs reserve bin designation + min/max for internal replenishment.

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Bin' AND COLUMN_NAME = 'isPickFace') = 0, 'ALTER TABLE `Bin` ADD COLUMN `isPickFace` BOOLEAN NOT NULL DEFAULT false', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Bin' AND COLUMN_NAME = 'pickFaceMin') = 0, 'ALTER TABLE `Bin` ADD COLUMN `pickFaceMin` DOUBLE NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Bin' AND COLUMN_NAME = 'pickFaceMax') = 0, 'ALTER TABLE `Bin` ADD COLUMN `pickFaceMax` DOUBLE NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

