-- Audit C-3: root-cause reason code captured when a count is reviewed. Nullable, additive.
ALTER TABLE "StockCount" ADD COLUMN "reasonCode" TEXT;
