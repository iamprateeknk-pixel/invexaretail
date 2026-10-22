-- Slice 2 of the quantity Decimal migration (R6): document/line/rule
-- quantity columns move from DOUBLE PRECISION to NUMERIC(18,3) so that
-- fractional quantities (KG, litres, cut lengths) are stored exactly.
-- Converting float8 -> numeric rounds binary float artifacts to the
-- column precision (e.g. 2.6750000000000003 becomes exactly 2.675);
-- values beyond 3 decimal places of quantity precision are not
-- representable in the business domain and are rounded by design.
-- Nullable columns keep their nullability; column defaults of 0 remain
-- valid for NUMERIC. SupplierPriceBreak."minQty" participates in a
-- unique index; ALTER COLUMN TYPE rebuilds that index automatically.
-- Rollback: ALTER each column back to DOUBLE PRECISION.

ALTER TABLE "TransferLine" ALTER COLUMN "requestedQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferLine" ALTER COLUMN "pickedQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferLine" ALTER COLUMN "receivedQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferLine" ALTER COLUMN "damagedQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferLine" ALTER COLUMN "shortageQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferLine" ALTER COLUMN "excessQty" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "TransferReceiptLine" ALTER COLUMN "receivedQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferReceiptLine" ALTER COLUMN "damagedQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferReceiptLine" ALTER COLUMN "shortageQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferReceiptLine" ALTER COLUMN "excessQty" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "OrderLine" ALTER COLUMN "requestedQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "OrderLine" ALTER COLUMN "fulfilledQty" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "StockCount" ALTER COLUMN "physicalQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockCount" ALTER COLUMN "bookQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockCount" ALTER COLUMN "bookQtyOriginal" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "StockCount" ALTER COLUMN "lateDelta" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "PutawayTask" ALTER COLUMN "quantity" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "PackedLine" ALTER COLUMN "quantity" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "ReturnLine" ALTER COLUMN "quantity" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "SupplierInvoiceLine" ALTER COLUMN "invoicedQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "OpeningStockSnapshot" ALTER COLUMN "qty" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "ReorderRule" ALTER COLUMN "minQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "ReorderRule" ALTER COLUMN "targetQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "ReorderRule" ALTER COLUMN "orderMultiple" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "ReplenishmentSuggestion" ALTER COLUMN "currentStock" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "ReplenishmentSuggestion" ALTER COLUMN "minRequired" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "ReplenishmentSuggestion" ALTER COLUMN "targetStock" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "ReplenishmentSuggestion" ALTER COLUMN "suggestedQty" SET DATA TYPE NUMERIC(18,3);

ALTER TABLE "Supplier" ALTER COLUMN "moq" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "SupplierPriceBreak" ALTER COLUMN "minQty" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "EvidenceRule" ALTER COLUMN "quantityThreshold" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "ExceptionCase" ALTER COLUMN "quantity" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "ExpiryAlert" ALTER COLUMN "quantity" SET DATA TYPE NUMERIC(18,3);
ALTER TABLE "TransferCarton" ALTER COLUMN "quantity" SET DATA TYPE NUMERIC(18,3);
