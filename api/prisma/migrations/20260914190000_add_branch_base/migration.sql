/*
  Branch exists in the Prisma schema and is referenced by ExceptionCase and
  later rule tables, but no earlier migration created it. Create the missing
  base table before exception_inbox and connect locations to branches.
*/
CREATE TABLE `Branch` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'WAREHOUSE',
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
    `address` TEXT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `managerId` VARCHAR(191) NULL,
    `workingHours` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Branch_code_key`(`code`),
    INDEX `Branch_code_status_idx`(`code`, `status`),
    INDEX `Branch_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Location`
    ADD COLUMN `branchId` VARCHAR(191) NULL;

ALTER TABLE `Location`
    ADD CONSTRAINT `Location_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
