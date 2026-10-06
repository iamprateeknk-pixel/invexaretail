-- Plan P0-SYNC-003: exactly-once replay receipts (additive: one new table).
CREATE TABLE "MutationReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MutationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MutationReceipt_companyId_userId_mutationId_key" ON "MutationReceipt"("companyId", "userId", "mutationId");
CREATE INDEX "MutationReceipt_createdAt_idx" ON "MutationReceipt"("createdAt");
