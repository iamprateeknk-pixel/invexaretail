-- Audit T-1.
-- 1) Job had no company column at all. Add it, backfill from the job's own Location (same pattern as
--    PurchaseOrder/Order/Transfer/StockCount/ExpiryAlert/ReorderRule), index it.
ALTER TABLE "Job" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
UPDATE "Job" j SET "companyId" = loc."companyId" FROM "Location" loc WHERE j."locationId" = loc."id";
CREATE INDEX "Job_companyId_idx" ON "Job"("companyId");

-- 2) Job and PurchaseOrder numbers become unique per company. Every existing number is already
--    globally unique, so it is necessarily unique per company: no data changes.
DROP INDEX "Job_number_key";
DROP INDEX "PurchaseOrder_number_key";
CREATE UNIQUE INDEX "Job_companyId_number_key" ON "Job"("companyId", "number");
CREATE UNIQUE INDEX "PurchaseOrder_companyId_number_key" ON "PurchaseOrder"("companyId", "number");
