-- Decimal migration slice 2 (docs/decimal-migration-plan.md): ExceptionCase.valueAtRisk -> NUMERIC(14,2).
-- Written once at case creation (lib/exceptions.ts) and only read for display, priority and
-- reporting - never used in arithmetic - so the same low-risk shape as the ApprovalRequest pilot.
-- Rounds to 2dp per the money rounding policy. Exception-detection query for a real run:
--   SELECT id, "valueAtRisk", ROUND("valueAtRisk"::numeric, 2) AS proposed_value
--   FROM "ExceptionCase"
--   WHERE ABS("valueAtRisk" - ROUND("valueAtRisk"::numeric, 2)) > 0.0001;
ALTER TABLE "ExceptionCase"
  ALTER COLUMN "valueAtRisk" TYPE NUMERIC(14, 2) USING ROUND("valueAtRisk"::numeric, 2);
