-- Audit P0-3: identity is per company. Item.code, Location.code and Branch.code were
-- globally unique, so a second customer could not use a SKU / location / branch code
-- the first one already had. Each becomes unique per company.
--
-- Additive-safe: every existing row is already unique on `code` alone, so it is
-- necessarily unique on (companyId, code); no data is changed or dropped.
-- Rollback: drop the compound indexes and recreate the single-column ones (only
-- possible while no two companies share a code).
DROP INDEX "Item_code_key";
DROP INDEX "Location_code_key";
DROP INDEX "Branch_code_key";

CREATE UNIQUE INDEX "Item_companyId_code_key" ON "Item"("companyId", "code");
CREATE UNIQUE INDEX "Location_companyId_code_key" ON "Location"("companyId", "code");
CREATE UNIQUE INDEX "Branch_companyId_code_key" ON "Branch"("companyId", "code");
