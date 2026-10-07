-- Decimal migration slice 6 (docs/decimal-migration-plan.md): Item.mrp, money, round-half-up to 2dp.
-- Exception-detection query to run before a real migration:
--   SELECT id, mrp FROM "Item" WHERE mrp IS NOT NULL AND ABS(mrp - ROUND(mrp::numeric, 2)) > 0.0001;
ALTER TABLE "Item" ALTER COLUMN "mrp" TYPE NUMERIC(14, 2) USING ROUND("mrp"::numeric, 2);
