-- Decimal migration slice 4 (docs/decimal-migration-plan.md): the three rule-threshold money columns.
-- Money rounding policy: round-half-up to 2dp. Before a real run, route any row whose rounding
-- delta exceeds tolerance to human review:
--   SELECT id, "valueThreshold" FROM "ApprovalRule" WHERE ABS("valueThreshold" - ROUND("valueThreshold"::numeric, 2)) > 0.0001;
--   (same for "EvidenceRule" and "ToleranceRule")
ALTER TABLE "ApprovalRule" ALTER COLUMN "valueThreshold" TYPE NUMERIC(14, 2) USING ROUND("valueThreshold"::numeric, 2);
ALTER TABLE "EvidenceRule" ALTER COLUMN "valueThreshold" TYPE NUMERIC(14, 2) USING ROUND("valueThreshold"::numeric, 2);
ALTER TABLE "ToleranceRule" ALTER COLUMN "valueThreshold" TYPE NUMERIC(14, 2) USING ROUND("valueThreshold"::numeric, 2);
