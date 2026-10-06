-- Plan Area B WP4: stock reconciliation evidence (additive: one new table).
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "ledgerRows" INTEGER NOT NULL,
    "explained" INTEGER NOT NULL,
    "mismatches" INTEGER NOT NULL,
    "noJournalHistory" INTEGER NOT NULL,
    "mismatchAbsDelta" DOUBLE PRECISION NOT NULL,
    "maxAbsDelta" DOUBLE PRECISION NOT NULL,
    "sampleJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReconciliationRun_companyId_startedAt_idx" ON "ReconciliationRun"("companyId", "startedAt");
