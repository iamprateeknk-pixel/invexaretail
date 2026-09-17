-- P6: sync journal (payload hash, next retry) + dead-letter replay (stored body).

ALTER TABLE `WebhookDeliveryLog`
  ADD COLUMN IF NOT EXISTS `payloadHash` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `nextRetryAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `body` TEXT NULL;
