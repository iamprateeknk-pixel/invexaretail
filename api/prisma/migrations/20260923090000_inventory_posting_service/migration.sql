-- AlterTable
ALTER TABLE "StockBalance" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "StockLedger" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company',
ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE INDEX "StockBalance_companyId_idx" ON "StockBalance"("companyId");

-- CreateIndex
CREATE INDEX "StockLedger_companyId_idx" ON "StockLedger"("companyId");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_idx" ON "StockMovement"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_companyId_idempotencyKey_key" ON "StockMovement"("companyId", "idempotencyKey");

