-- Additive company isolation for operational masters. Stock/count/transfer
-- rows stay location-scoped; User/Branch/Location/Item now carry companyId.
-- DEFAULT backfills existing Hostinger rows to the grocery tenant.
ALTER TABLE `User` ADD COLUMN `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company';
ALTER TABLE `Branch` ADD COLUMN `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company';
ALTER TABLE `Location` ADD COLUMN `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company';
ALTER TABLE `Item` ADD COLUMN `companyId` VARCHAR(191) NOT NULL DEFAULT 'default-company';

CREATE INDEX `User_companyId_idx` ON `User`(`companyId`);
CREATE INDEX `Branch_companyId_idx` ON `Branch`(`companyId`);
CREATE INDEX `Location_companyId_idx` ON `Location`(`companyId`);
CREATE INDEX `Item_companyId_idx` ON `Item`(`companyId`);
