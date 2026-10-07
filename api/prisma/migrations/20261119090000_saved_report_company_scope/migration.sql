-- SavedReport had only an owner id: "shared" reports were visible to every company and any admin
-- could delete another company's report. Add the owner's company and backfill it from the owner.
ALTER TABLE "SavedReport" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
UPDATE "SavedReport" AS r SET "companyId" = u."companyId" FROM "User" AS u WHERE u."id" = r."ownerId";
CREATE INDEX "SavedReport_companyId_idx" ON "SavedReport"("companyId");
