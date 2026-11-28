ALTER TABLE "ApprovalRequest"
  ALTER COLUMN "ruleId" DROP NOT NULL,
  ADD COLUMN "workflowPolicy" JSONB;

ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_policy_source_check"
  CHECK (("ruleId" IS NOT NULL) <> ("workflowPolicy" IS NOT NULL));
