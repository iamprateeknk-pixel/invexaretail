-- Blueprint v4 §6 canonical Item Master: lifecycle status (archive instead of
-- delete when history exists), barcode, tax/commercial references, planning
-- hints, ERP aliases and governance fields. Additive; existing items become
-- ACTIVE at version 1.
ALTER TABLE `Item`
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `archiveReason` VARCHAR(191) NULL,
  ADD COLUMN `archivedAt` DATETIME(3) NULL,
  ADD COLUMN `archivedById` VARCHAR(191) NULL,
  ADD COLUMN `barcode` VARCHAR(191) NULL,
  ADD COLUMN `hsn` VARCHAR(191) NULL,
  ADD COLUMN `gstRate` DOUBLE NULL,
  ADD COLUMN `mrp` DOUBLE NULL,
  ADD COLUMN `leadTimeDays` INTEGER NULL,
  ADD COLUMN `shelfLifeDays` INTEGER NULL,
  ADD COLUMN `aliases` JSON NULL,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `createdById` VARCHAR(191) NULL,
  ADD COLUMN `updatedById` VARCHAR(191) NULL,
  ADD INDEX `Item_status_idx` (`status`),
  ADD INDEX `Item_barcode_idx` (`barcode`);
