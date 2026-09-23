-- P7: landed cost charges on PurchaseOrder.

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PurchaseOrder' AND COLUMN_NAME = 'freightCost') = 0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `freightCost` DOUBLE NULL DEFAULT 0', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PurchaseOrder' AND COLUMN_NAME = 'customsCost') = 0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `customsCost` DOUBLE NULL DEFAULT 0', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PurchaseOrder' AND COLUMN_NAME = 'insuranceCost') = 0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `insuranceCost` DOUBLE NULL DEFAULT 0', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PurchaseOrder' AND COLUMN_NAME = 'handlingCost') = 0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `handlingCost` DOUBLE NULL DEFAULT 0', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PurchaseOrder' AND COLUMN_NAME = 'landedCostMethod') = 0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `landedCostMethod` VARCHAR(191) NULL DEFAULT ''VALUE''', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

