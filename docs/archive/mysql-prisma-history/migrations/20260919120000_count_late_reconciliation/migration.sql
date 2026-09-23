-- Blueprint v4 §14: a sales/purchase import can carry movements dated before
-- an existing count. Flag those counts (recomputing the book quantity of a
-- still-pending one) instead of silently leaving a stale comparison.
ALTER TABLE `StockCount`
  ADD COLUMN `reconciliationRequired` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `reconciliationNote` TEXT NULL,
  ADD COLUMN `reconciliationAt` DATETIME(3) NULL,
  ADD COLUMN `bookQtyOriginal` DOUBLE NULL,
  ADD COLUMN `lateDelta` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `lateMovementKeys` JSON NULL,
  ADD INDEX `StockCount_reconciliationRequired_idx` (`reconciliationRequired`);
