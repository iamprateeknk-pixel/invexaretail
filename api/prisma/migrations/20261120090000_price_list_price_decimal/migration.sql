-- Decimal migration slice 5 (docs/decimal-migration-plan.md): PriceList.price, money, round-half-up to 2dp.
-- Exception-detection query to run before a real migration:
--   SELECT id, price FROM "PriceList" WHERE ABS(price - ROUND(price::numeric, 2)) > 0.0001;
ALTER TABLE "PriceList" ALTER COLUMN "price" TYPE NUMERIC(14, 2) USING ROUND("price"::numeric, 2);
