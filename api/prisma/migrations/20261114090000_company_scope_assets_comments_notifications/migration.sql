-- Plan M1 (P0-SEC-002/003/004): genuine company ownership for AssetCheckout,
-- ContextComment and UserNotification, which had none (only a constant tenantId,
-- or nothing at all). Additive: new column + backfill + index per table.
--
-- Backfill sources (each is the row's own owning parent, never a guess):
--   AssetCheckout   <- Location.companyId of its locationId
--   ContextComment  <- User.companyId of its authorId
--   UserNotification<- User.companyId of its userId
-- Rows whose parent cannot be resolved (a comment by a since-deleted user; a
-- role-wide or global notification with no recipient user) keep the 'default-company'
-- constant, the same documented fallback the earlier ownership migrations use.
-- Unresolved-row report for a real run:
--   SELECT count(*) FROM "AssetCheckout"  a LEFT JOIN "Location" l ON l.id = a."locationId" WHERE l.id IS NULL;
--   SELECT count(*) FROM "ContextComment" c LEFT JOIN "User" u ON u.id = c."authorId" WHERE u.id IS NULL;
--   SELECT count(*) FROM "UserNotification" WHERE "userId" IS NULL;

ALTER TABLE "AssetCheckout" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
UPDATE "AssetCheckout" a SET "companyId" = l."companyId" FROM "Location" l WHERE l."id" = a."locationId";
CREATE INDEX "AssetCheckout_companyId_idx" ON "AssetCheckout"("companyId");

ALTER TABLE "ContextComment" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
UPDATE "ContextComment" c SET "companyId" = u."companyId" FROM "User" u WHERE u."id" = c."authorId";
CREATE INDEX "ContextComment_companyId_idx" ON "ContextComment"("companyId");

ALTER TABLE "UserNotification" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
UPDATE "UserNotification" n SET "companyId" = u."companyId" FROM "User" u WHERE u."id" = n."userId";
CREATE INDEX "UserNotification_companyId_idx" ON "UserNotification"("companyId");
