-- Phase 3 (R3), StockLedger step: the companyId placeholder default
-- 'default-company' is dropped from StockLedger and StockBalance, and the
-- StockLedger unique key becomes tenant-qualified.
-- Until now any writer that forgot companyId silently filed stock under
-- the fake 'default-company' tenant, and the unique key
-- (itemId, lotId, locationId) forbade two companies from holding the same
-- item+lot at the same location id — exactly the seeded/demo collision
-- case multi-tenancy must survive.
-- Order inside this migration matters:
--   1. Backfill first: rows whose companyId disagrees with their
--      location's company are re-filed under the location's company.
--      This must run BEFORE the unique swap, or two rows that differ
--      only by a wrong companyId would collide mid-migration.
--   2. Swap the unique index.
--   3. Drop the placeholder defaults (columns stay, now required with
--      no default — Prisma writers must name the company explicitly).
-- StockBalance deliberately keeps its old unique key: nothing writes it
-- (dead projection, ADR-001) and its lotId is nullable, so the key is
-- only a partial guard there anyway.
-- Rollback: restore the defaults, drop the new unique index and
-- recreate the old one. The backfill is not reversible (by design —
-- the pre-backfill companyIds were wrong).

UPDATE "StockLedger" sl
   SET "companyId" = l."companyId"
  FROM "Location" l
 WHERE l.id = sl."locationId" AND sl."companyId" <> l."companyId";
UPDATE "StockBalance" sb
   SET "companyId" = l."companyId"
  FROM "Location" l
 WHERE l.id = sb."locationId" AND sb."companyId" <> l."companyId";

DROP INDEX "StockLedger_itemId_lotId_locationId_key";
CREATE UNIQUE INDEX "StockLedger_companyId_itemId_lotId_locationId_key" ON "StockLedger"("companyId", "itemId", "lotId", "locationId");

ALTER TABLE "StockLedger"  ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "StockBalance" ALTER COLUMN "companyId" DROP DEFAULT;
