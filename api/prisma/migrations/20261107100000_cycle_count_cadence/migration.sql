-- Audit C-4: optional per-company cycle-count cadence override (days between required counts,
-- by ABC class). NULL = the 7/30/90 default in ABC_CADENCE (lib/abc-cycle-count.ts).
ALTER TABLE "CompanyProfile" ADD COLUMN "cycleCountCadenceADays" INTEGER;
ALTER TABLE "CompanyProfile" ADD COLUMN "cycleCountCadenceBDays" INTEGER;
ALTER TABLE "CompanyProfile" ADD COLUMN "cycleCountCadenceCDays" INTEGER;
