-- Additive only: a new table, nothing existing is changed.
CREATE TABLE "ControlPanelAppLink" (
    "appUserId" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPanelAppLink_pkey" PRIMARY KEY ("appUserId")
);

CREATE INDEX "ControlPanelAppLink_platformUserId_idx" ON "ControlPanelAppLink"("platformUserId");
