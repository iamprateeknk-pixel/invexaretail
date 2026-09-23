-- Blueprint §17.1 (Intelligence Action Center): "accept/edit/dismiss with
-- an audit trail" - accept already has a real audit trail (the created
-- Transfer/PurchaseOrder); this adds the dismiss half. Time-bounded (read
-- side filters to the last 24h) so a dismissal doesn't silently hide a
-- still-valid recommendation forever. FK-free for the same
-- restricted-MySQL reason as the other rule/result tables in this app.
CREATE TABLE `IntelligenceDismissal` (
  `id` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `countId` VARCHAR(191) NULL,
  `reason` VARCHAR(191) NULL,
  `dismissedById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `IntelligenceDismissal_locationId_itemId_type_createdAt_idx` (`locationId`, `itemId`, `type`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
