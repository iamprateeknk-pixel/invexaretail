CREATE TABLE "StudioAutomationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "automationKey" TEXT NOT NULL,
    "occurrence" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "versionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioAutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudioAutomationRun_companyId_automationKey_occurrence_key" ON "StudioAutomationRun"("companyId", "automationKey", "occurrence");
CREATE INDEX "StudioAutomationRun_status_nextAttemptAt_idx" ON "StudioAutomationRun"("status", "nextAttemptAt");
CREATE INDEX "StudioAutomationRun_companyId_createdAt_idx" ON "StudioAutomationRun"("companyId", "createdAt");
