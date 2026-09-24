-- Week 12: ExceptionCase had no per-company scoping column at all (only a
-- constant tenantId) - additive, backfilled to the existing default so no
-- row is left unscoped.
ALTER TABLE "ExceptionCase" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "ExceptionCase_companyId_idx" ON "ExceptionCase"("companyId");
