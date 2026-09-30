-- Decimal migration pilot (docs/decimal-migration-plan.md): ApprovalRequest.valueAtStake is the
-- safest first field to convert - write-only in application code, never used in arithmetic or
-- comparison (checkApprovalGate compares the plain-number `value` argument against
-- ApprovalRule.valueThreshold, which stays Float for now; this column is only ever written once
-- at request creation and read back for display).
-- Rounds to 2dp per the money rounding policy. Per the plan's rehearsal, a real (non-rehearsal)
-- run of this migration should first run the exception-detection query below and route any row
-- whose rounding delta exceeds tolerance to human review before applying the ALTER:
--   SELECT id, "valueAtStake", ROUND("valueAtStake"::numeric, 2) AS proposed_value
--   FROM "ApprovalRequest"
--   WHERE ABS("valueAtStake" - ROUND("valueAtStake"::numeric, 2)) > 0.0001;
ALTER TABLE "ApprovalRequest"
  ALTER COLUMN "valueAtStake" TYPE NUMERIC(14, 2) USING ROUND("valueAtStake"::numeric, 2);
