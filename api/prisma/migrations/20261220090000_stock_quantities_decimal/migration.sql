-- R6 (Phase 2, slice 1): core stock quantities were DOUBLE PRECISION (Float)
-- while money moved to DECIMAL long ago. Fractional KG stock accumulated
-- binary float error (2.675 stored as 2.6750000000000003) and balances could
-- drift by epsilon across postings.
--
-- These columns become NUMERIC(18,3): quantities in this product carry at
-- most 3 decimal places by design (KG workflows round to 3), so the cast
-- rounds float artifacts to the exact intended value. Precision 18 matches
-- the headroom style of unitCost DECIMAL(18,4); scale 3 matches
-- ItemBundleComponent.quantity DECIMAL(12,3).
--
-- Rollback: ALTER each column back to DOUBLE PRECISION USING <col>::double
-- precision - lossless for values that fit NUMERIC(18,3).

ALTER TABLE "StockLedger" ALTER COLUMN "onHand" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockLedger" ALTER COLUMN "reserved" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockLedger" ALTER COLUMN "inTransit" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockLedger" ALTER COLUMN "quarantine" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockLedger" ALTER COLUMN "damaged" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "StockBalance" ALTER COLUMN "onHand" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockBalance" ALTER COLUMN "reserved" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockBalance" ALTER COLUMN "inTransit" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockBalance" ALTER COLUMN "available" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "BinStock" ALTER COLUMN "onHand" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "BinStock" ALTER COLUMN "reserved" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "BinMovement" ALTER COLUMN "quantity" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "StockMovement" ALTER COLUMN "qtyDelta" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockMovement" ALTER COLUMN "beforeBalance" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockMovement" ALTER COLUMN "afterBalance" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "InventoryMovement" ALTER COLUMN "qtyDelta" SET DATA TYPE NUMERIC(18,3);
