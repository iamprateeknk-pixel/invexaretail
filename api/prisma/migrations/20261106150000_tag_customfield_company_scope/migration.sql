-- Audit T-1: Tag and CustomFieldDefinition were global (one shared list, names unique across every
-- tenant). They become per company.
-- Backfill: a definition takes the company of the items that use it (lowest company id when several
-- companies happen to share one row); unused definitions stay with 'default-company'.
ALTER TABLE "Tag" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
UPDATE "Tag" t SET "companyId" = u."companyId" FROM (
  SELECT it."tagId", MIN(i."companyId") AS "companyId" FROM "ItemTag" it JOIN "Item" i ON i."id" = it."itemId" GROUP BY it."tagId"
) u WHERE t."id" = u."tagId";
DROP INDEX "Tag_name_key";
CREATE UNIQUE INDEX "Tag_companyId_name_key" ON "Tag"("companyId", "name");
CREATE INDEX "Tag_companyId_idx" ON "Tag"("companyId");

ALTER TABLE "CustomFieldDefinition" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
UPDATE "CustomFieldDefinition" f SET "companyId" = u."companyId" FROM (
  SELECT v."fieldId", MIN(i."companyId") AS "companyId" FROM "CustomFieldValue" v JOIN "Item" i ON i."id" = v."itemId" GROUP BY v."fieldId"
) u WHERE f."id" = u."fieldId";
DROP INDEX "CustomFieldDefinition_name_key";
CREATE UNIQUE INDEX "CustomFieldDefinition_companyId_name_key" ON "CustomFieldDefinition"("companyId", "name");
CREATE INDEX "CustomFieldDefinition_companyId_idx" ON "CustomFieldDefinition"("companyId");
