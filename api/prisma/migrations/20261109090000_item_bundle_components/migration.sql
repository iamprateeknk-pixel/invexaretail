-- Virtual bundles/kits (additive: one new table, no existing data touched).
-- CreateTable
CREATE TABLE "ItemBundleComponent" (
    "id" TEXT NOT NULL,
    "bundleItemId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "tenantId" TEXT NOT NULL DEFAULT 'tenant-invexa',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemBundleComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemBundleComponent_companyId_idx" ON "ItemBundleComponent"("companyId");

-- CreateIndex
CREATE INDEX "ItemBundleComponent_componentItemId_idx" ON "ItemBundleComponent"("componentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemBundleComponent_bundleItemId_componentItemId_key" ON "ItemBundleComponent"("bundleItemId", "componentItemId");

-- AddForeignKey
ALTER TABLE "ItemBundleComponent" ADD CONSTRAINT "ItemBundleComponent_bundleItemId_fkey" FOREIGN KEY ("bundleItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemBundleComponent" ADD CONSTRAINT "ItemBundleComponent_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

