-- Phase 3 (R3): BinStock and BinMovement gain tenant columns.
-- Until now bin-level stock had no companyId at all: tenant isolation
-- rested entirely on callers remembering to scope by location.
-- Backfill derives each row's company from its own location
-- (BinStock.locationId -> Location.companyId) — one hop, and independent
-- of the un-relationed binId string, which may name a pseudo-bin such as
-- '__STAGING__' or a bin that lives in another location.
-- A row whose locationId matches no Location keeps NULL here and fails
-- the NOT NULL step loudly rather than being silently re-homed to an
-- invented company. Pre-flight check for operators:
--   SELECT count(*) FROM "BinStock" bs LEFT JOIN "Location" l ON l.id = bs."locationId" WHERE l.id IS NULL;
--   SELECT count(*) FROM "BinMovement" bm LEFT JOIN "Location" l ON l.id = bm."locationId" WHERE l.id IS NULL;
-- tenantId carries the platform default 'tenant-invexa' (foundation
-- convention); companyId deliberately has NO default — a bin-stock write
-- must name its company, so the placeholder failure mode of StockLedger
-- is not recreated in the new column.
-- The BinStock unique key becomes tenant-qualified:
-- [companyId, itemId, lotId, locationId, binId].
-- Rollback: drop the new unique index and restore the old one, drop the
-- four indexes, then drop the four columns.

ALTER TABLE "BinStock"    ADD COLUMN "tenantId"  TEXT;
ALTER TABLE "BinStock"    ADD COLUMN "companyId" TEXT;
ALTER TABLE "BinMovement" ADD COLUMN "tenantId"  TEXT;
ALTER TABLE "BinMovement" ADD COLUMN "companyId" TEXT;

UPDATE "BinStock" bs
   SET "companyId" = l."companyId", "tenantId" = l."tenantId"
  FROM "Location" l
 WHERE l.id = bs."locationId";
UPDATE "BinMovement" bm
   SET "companyId" = l."companyId", "tenantId" = l."tenantId"
  FROM "Location" l
 WHERE l.id = bm."locationId";

ALTER TABLE "BinStock"    ALTER COLUMN "tenantId"  SET DEFAULT 'tenant-invexa';
ALTER TABLE "BinMovement" ALTER COLUMN "tenantId"  SET DEFAULT 'tenant-invexa';
ALTER TABLE "BinStock"    ALTER COLUMN "tenantId"  SET NOT NULL;
ALTER TABLE "BinMovement" ALTER COLUMN "tenantId"  SET NOT NULL;
ALTER TABLE "BinStock"    ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "BinMovement" ALTER COLUMN "companyId" SET NOT NULL;

CREATE INDEX "BinStock_tenantId_idx"    ON "BinStock"("tenantId");
CREATE INDEX "BinStock_companyId_idx"   ON "BinStock"("companyId");
CREATE INDEX "BinMovement_tenantId_idx" ON "BinMovement"("tenantId");
CREATE INDEX "BinMovement_companyId_idx" ON "BinMovement"("companyId");

DROP INDEX "BinStock_itemId_lotId_locationId_binId_key";
CREATE UNIQUE INDEX "BinStock_companyId_itemId_lotId_locationId_binId_key" ON "BinStock"("companyId", "itemId", "lotId", "locationId", "binId");
