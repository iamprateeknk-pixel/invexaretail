-- P7: 3-way match (PO vs GRN vs supplier invoice).

CREATE TABLE IF NOT EXISTS `SupplierInvoice` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderId` VARCHAR(191) NOT NULL,
  `invoiceNumber` VARCHAR(191) NOT NULL,
  `invoiceDate` DATETIME(3) NULL,
  `totalAmount` DOUBLE NOT NULL DEFAULT 0,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `matchResult` JSON NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
  PRIMARY KEY (`id`),
  INDEX `SupplierInvoice_purchaseOrderId_idx` (`purchaseOrderId`),
  INDEX `SupplierInvoice_tenantId_idx` (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SupplierInvoiceLine` (
  `id` VARCHAR(191) NOT NULL,
  `supplierInvoiceId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `invoicedQty` DOUBLE NOT NULL,
  `unitCost` DOUBLE NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `SupplierInvoiceLine_supplierInvoiceId_idx` (`supplierInvoiceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
