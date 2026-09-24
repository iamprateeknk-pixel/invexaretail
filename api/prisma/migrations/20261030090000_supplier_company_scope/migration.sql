-- Bare-id call-site migration, slice 6 (see docs/tenant-scope-coverage.md):
-- Supplier had no per-company scoping column at all (only the constant
-- tenantId) - the same complete gap ExceptionCase had before Week 12.
-- Unlike PurchaseOrder/Order/Transfer/StockCount/ExpiryAlert, a Supplier
-- has no Location (or any other single-owner relation) to backfill from -
-- a supplier can legitimately have purchase orders from more than one
-- company today, precisely because this gap let that happen. There is no
-- honest single "true owner" to compute, so every existing row is
-- backfilled to the same 'default-company' constant every other backfill
-- in this migration series defaults to when no better source exists (see
-- ExceptionCase, Week 12). This is a known, documented approximation, not
-- a claim that every pre-existing supplier really belongs to that company -
-- see docs/week28-item-supplier-bare-id-remediation.md.
ALTER TABLE "Supplier" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "Supplier_companyId_idx" ON "Supplier"("companyId");
