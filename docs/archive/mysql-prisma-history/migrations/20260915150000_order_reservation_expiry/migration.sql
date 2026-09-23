-- Blueprint §13.3 residual scope item: "reservation expiry" - an order's
-- stock reservation now has a TTL so an abandoned RESERVED order does not
-- hold stock indefinitely.
ALTER TABLE `Order` ADD COLUMN `reservationExpiresAt` DATETIME(3) NULL;
ALTER TABLE `Order` ADD COLUMN `expiredAt` DATETIME(3) NULL;
CREATE INDEX `Order_status_reservationExpiresAt_idx` ON `Order` (`status`, `reservationExpiresAt`);
