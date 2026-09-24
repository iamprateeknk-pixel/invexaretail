-- Third slice of the tenant-scope migration Weeks 17/19 started for
-- PurchaseOrder/Order. Transfer had no real per-company scoping column
-- (only the constant tenantId). Add companyId, additive-only, then
-- backfill it from each transfer's own sourceLocation.companyId (the
-- location that authorized the transfer out).
ALTER TABLE "Transfer" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "Transfer_companyId_idx" ON "Transfer"("companyId");

UPDATE "Transfer" t
SET "companyId" = loc."companyId"
FROM "Location" loc
WHERE t."sourceLocationId" = loc."id";
