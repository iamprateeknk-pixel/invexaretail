-- Wave 3 (P2-16): marketplace order uniqueness is per-company.
-- The old constraint was global - @@unique([channel, externalReference]) -
-- while every lookup (orders.ts findOrderByExternalReference) is already
-- company-scoped. If two companies ever ingest through the same channel
-- namespace, company B's order would be rejected purely because company A
-- used the same external reference first.
--
-- PRE-DEPLOY DEDUPE CHECK (deploy-time — not code):
--   SELECT "channel", "externalReference", COUNT(*) AS rows, COUNT(DISTINCT "companyId") AS companies
--   FROM "Order" WHERE "externalReference" IS NOT NULL
--   GROUP BY "channel", "externalReference" HAVING COUNT(*) > 1;
-- Expected under the old global unique: 0 rows with rows > 1 at all; the
-- check documents any externalReference shared across companies before the
-- constraint is relaxed to per-company scope. Violations of the NEW
-- constraint are impossible in existing data (it is strictly weaker).
DROP INDEX IF EXISTS "Order_channel_externalReference_key";
CREATE UNIQUE INDEX "Order_companyId_channel_externalReference_key" ON "Order"("companyId", "channel", "externalReference");
