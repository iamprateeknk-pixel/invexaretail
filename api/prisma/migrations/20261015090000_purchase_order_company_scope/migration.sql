-- Week 17: PurchaseOrder had no real per-company scoping column (only the
-- constant tenantId). Add companyId, additive-only, then backfill it from
-- each order's own Location.companyId (falling back to the schema default
-- for any order whose locationId does not resolve, so no row is left with
-- a null/invalid value).
ALTER TABLE "PurchaseOrder" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "PurchaseOrder_companyId_idx" ON "PurchaseOrder"("companyId");

UPDATE "PurchaseOrder" po
SET "companyId" = loc."companyId"
FROM "Location" loc
WHERE po."locationId" = loc."id";
