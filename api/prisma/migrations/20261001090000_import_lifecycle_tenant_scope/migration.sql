-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "checkpointRowNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commitPolicy" TEXT NOT NULL DEFAULT 'PARTIAL_SUCCESS',
ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company',
ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ImportRow" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company',
ADD COLUMN     "movementId" TEXT;

-- CreateIndex
CREATE INDEX "ImportBatch_companyId_idx" ON "ImportBatch"("companyId");

-- CreateIndex
CREATE INDEX "ImportRow_companyId_idx" ON "ImportRow"("companyId");
