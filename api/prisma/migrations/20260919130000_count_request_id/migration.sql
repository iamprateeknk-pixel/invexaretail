-- Blueprint v4 §38 offline/idempotency: a client-generated key on a count so a
-- retried submit returns the count it already created instead of a duplicate.
ALTER TABLE `StockCount`
  ADD COLUMN `requestId` VARCHAR(191) NULL,
  ADD INDEX `StockCount_submittedById_requestId_idx` (`submittedById`, `requestId`);
