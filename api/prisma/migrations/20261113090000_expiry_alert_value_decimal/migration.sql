-- Decimal migration slice 3 (docs/decimal-migration-plan.md): ExpiryAlert.value -> NUMERIC(14,2).
-- No application code writes or reads this column (expiry alerts are created without it and
-- only quantity/status/dates are used), so the conversion cannot change behaviour. Rounds to 2dp.
-- Exception-detection query for a real run:
--   SELECT id, "value", ROUND("value"::numeric, 2) FROM "ExpiryAlert"
--   WHERE "value" IS NOT NULL AND ABS("value" - ROUND("value"::numeric, 2)) > 0.0001;
ALTER TABLE "ExpiryAlert"
  ALTER COLUMN "value" TYPE NUMERIC(14, 2) USING ROUND("value"::numeric, 2);
