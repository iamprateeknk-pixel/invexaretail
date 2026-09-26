-- Audit O-4: quantity price breaks per supplier and item. New table, additive.
CREATE TABLE "SupplierPriceBreak" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "minQty" DOUBLE PRECISION NOT NULL,
  "unitCost" DECIMAL(18,4) NOT NULL,
  "companyId" TEXT NOT NULL DEFAULT 'default-company',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPriceBreak_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierPriceBreak_supplierId_itemId_minQty_key" ON "SupplierPriceBreak"("supplierId", "itemId", "minQty");
CREATE INDEX "SupplierPriceBreak_companyId_idx" ON "SupplierPriceBreak"("companyId");
CREATE INDEX "SupplierPriceBreak_supplierId_itemId_idx" ON "SupplierPriceBreak"("supplierId", "itemId");
ALTER TABLE "SupplierPriceBreak" ADD CONSTRAINT "SupplierPriceBreak_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPriceBreak" ADD CONSTRAINT "SupplierPriceBreak_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
