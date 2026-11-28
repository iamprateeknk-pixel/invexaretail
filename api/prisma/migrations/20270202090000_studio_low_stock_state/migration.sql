CREATE TABLE "StudioLowStockState" (
    "companyId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "episodeId" TEXT,

    CONSTRAINT "StudioLowStockState_pkey" PRIMARY KEY ("companyId", "ruleId")
);
