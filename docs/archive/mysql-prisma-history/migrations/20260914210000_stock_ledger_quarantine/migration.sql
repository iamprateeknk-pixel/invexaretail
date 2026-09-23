-- Blueprint section 7.2 inventory state model: track quarantine and
-- damaged quantities on the stock ledger instead of leaving rejected
-- receiving/pick quantities untracked.
ALTER TABLE `StockLedger`
  ADD COLUMN `quarantine` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `damaged` DOUBLE NOT NULL DEFAULT 0;
