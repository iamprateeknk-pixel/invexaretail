CREATE TABLE `DomainEventOutbox` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `topic` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `locationIds` JSON NULL,
  `actorId` VARCHAR(191) NULL,
  `requestId` VARCHAR(191) NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `DomainEventOutbox_companyId_id_idx` (`companyId`, `id`),
  INDEX `DomainEventOutbox_occurredAt_idx` (`occurredAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;