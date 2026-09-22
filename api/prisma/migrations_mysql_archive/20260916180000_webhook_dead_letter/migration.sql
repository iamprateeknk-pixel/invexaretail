-- P6: sync journal (payload hash, next retry) + dead-letter replay (stored body).

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'WebhookDeliveryLog' AND COLUMN_NAME = 'payloadHash') = 0, 'ALTER TABLE `WebhookDeliveryLog` ADD COLUMN `payloadHash` VARCHAR(191) NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'WebhookDeliveryLog' AND COLUMN_NAME = 'nextRetryAt') = 0, 'ALTER TABLE `WebhookDeliveryLog` ADD COLUMN `nextRetryAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

SET @sqlstmt := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'WebhookDeliveryLog' AND COLUMN_NAME = 'body') = 0, 'ALTER TABLE `WebhookDeliveryLog` ADD COLUMN `body` TEXT NULL', 'SELECT 1');
PREPARE invexa_stmt FROM @sqlstmt;
EXECUTE invexa_stmt;
DEALLOCATE PREPARE invexa_stmt;

