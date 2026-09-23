-- P5: promise engine - estimated dispatch/delivery on Order.

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Order' AND COLUMN_NAME = 'estimatedDispatchAt') = 0, 'ALTER TABLE `Order` ADD COLUMN `estimatedDispatchAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Order' AND COLUMN_NAME = 'estimatedDeliveryAt') = 0, 'ALTER TABLE `Order` ADD COLUMN `estimatedDeliveryAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

