-- Blueprint Module H: excess receipt must never be silently absorbed into
-- the received quantity. Track it as its own column, same shape as the
-- existing damagedQty/shortageQty discrepancy columns.
ALTER TABLE `TransferLine` ADD COLUMN `excessQty` DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE `TransferReceiptLine` ADD COLUMN `excessQty` DOUBLE NOT NULL DEFAULT 0;
