-- Bare-id call-site migration, slice 7 (see docs/tenant-scope-coverage.md):
-- ReorderRule had no per-company scoping column at all (only the constant
-- tenantId). Unlike Supplier, ReorderRule does have a real locationId
-- relation to Location (which carries a real companyId), so it can be
-- backfilled the same way PurchaseOrder/Order/Transfer/StockCount/
-- ExpiryAlert were: join through the rule's own Location.
ALTER TABLE "ReorderRule" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "ReorderRule_companyId_idx" ON "ReorderRule"("companyId");

UPDATE "ReorderRule" rr
SET "companyId" = loc."companyId"
FROM "Location" loc
WHERE rr."locationId" = loc."id";
