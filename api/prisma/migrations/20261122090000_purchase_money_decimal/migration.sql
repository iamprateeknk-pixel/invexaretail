-- Decimal migration slice 7 (docs/decimal-migration-plan.md): the purchasing and shipping money columns.
-- Totals and charges: NUMERIC(14,2), round-half-up. Unit costs: NUMERIC(18,4) (a per-unit cost keeps
-- 4dp, like StockMovement.unitCost). Shipping cost per km: NUMERIC(14,4).
-- Exception-detection query to run per column before a real migration, for example:
--   SELECT id, "totalAmount" FROM "PurchaseOrder" WHERE ABS("totalAmount" - ROUND("totalAmount"::numeric, 2)) > 0.0001;
ALTER TABLE "PurchaseOrder"
  ALTER COLUMN "totalAmount" DROP DEFAULT,
  ALTER COLUMN "totalAmount" TYPE NUMERIC(14, 2) USING ROUND("totalAmount"::numeric, 2),
  ALTER COLUMN "totalAmount" SET DEFAULT 0,
  ALTER COLUMN "freightCost" DROP DEFAULT,
  ALTER COLUMN "freightCost" TYPE NUMERIC(14, 2) USING ROUND("freightCost"::numeric, 2),
  ALTER COLUMN "freightCost" SET DEFAULT 0,
  ALTER COLUMN "customsCost" DROP DEFAULT,
  ALTER COLUMN "customsCost" TYPE NUMERIC(14, 2) USING ROUND("customsCost"::numeric, 2),
  ALTER COLUMN "customsCost" SET DEFAULT 0,
  ALTER COLUMN "insuranceCost" DROP DEFAULT,
  ALTER COLUMN "insuranceCost" TYPE NUMERIC(14, 2) USING ROUND("insuranceCost"::numeric, 2),
  ALTER COLUMN "insuranceCost" SET DEFAULT 0,
  ALTER COLUMN "handlingCost" DROP DEFAULT,
  ALTER COLUMN "handlingCost" TYPE NUMERIC(14, 2) USING ROUND("handlingCost"::numeric, 2),
  ALTER COLUMN "handlingCost" SET DEFAULT 0;
ALTER TABLE "PurchaseOrderLine"
  ALTER COLUMN "unitCost" DROP DEFAULT,
  ALTER COLUMN "unitCost" TYPE NUMERIC(18, 4) USING ROUND("unitCost"::numeric, 4),
  ALTER COLUMN "unitCost" SET DEFAULT 0;
ALTER TABLE "SupplierInvoice"
  ALTER COLUMN "totalAmount" DROP DEFAULT,
  ALTER COLUMN "totalAmount" TYPE NUMERIC(14, 2) USING ROUND("totalAmount"::numeric, 2),
  ALTER COLUMN "totalAmount" SET DEFAULT 0;
ALTER TABLE "SupplierInvoiceLine"
  ALTER COLUMN "unitCost" TYPE NUMERIC(18, 4) USING ROUND("unitCost"::numeric, 4);
ALTER TABLE "Location"
  ALTER COLUMN "shippingCostPerKm" TYPE NUMERIC(14, 4) USING ROUND("shippingCostPerKm"::numeric, 4);
