-- Fourth and fifth slices of the tenant-scope migration Weeks 17/19
-- started for PurchaseOrder/Order/Transfer. StockCount and ExpiryAlert had
-- no real per-company scoping column (only the constant tenantId). Add
-- companyId to both, additive-only, then backfill from each row's own
-- Location.
ALTER TABLE "StockCount" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "StockCount_companyId_idx" ON "StockCount"("companyId");

UPDATE "StockCount" sc
SET "companyId" = loc."companyId"
FROM "Location" loc
WHERE sc."locationId" = loc."id";

ALTER TABLE "ExpiryAlert" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "ExpiryAlert_companyId_idx" ON "ExpiryAlert"("companyId");

UPDATE "ExpiryAlert" ea
SET "companyId" = loc."companyId"
FROM "Location" loc
WHERE ea."locationId" = loc."id";
