CREATE TABLE "CountSubmissionReceipt" (
    "companyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "countIds" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CountSubmissionReceipt_pkey" PRIMARY KEY ("companyId", "actorId", "requestId")
);
