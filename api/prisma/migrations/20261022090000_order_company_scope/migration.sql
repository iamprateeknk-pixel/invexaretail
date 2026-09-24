-- Week 19: Order had no real per-company scoping column (only the constant
-- tenantId). Add companyId, additive-only, then backfill it from each
-- order's own fulfillmentLocation.companyId.
ALTER TABLE "Order" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "Order_companyId_idx" ON "Order"("companyId");

UPDATE "Order" o
SET "companyId" = loc."companyId"
FROM "Location" loc
WHERE o."fulfillmentLocationId" = loc."id";
