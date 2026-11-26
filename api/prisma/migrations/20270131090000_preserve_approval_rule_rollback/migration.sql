-- Keep historical Studio decisions and restore the rule reference expected by older API images.
INSERT INTO "ApprovalRule" (
  "id", "label", "triggerType", "valueThreshold", "requiredApproverRole", "active", "createdById", "updatedAt"
)
SELECT 'studio-snapshot:' || "id", "workflowPolicy"->>'label', 'STUDIO_WORKFLOW_SNAPSHOT',
       ("workflowPolicy"->>'threshold')::numeric, "workflowPolicy"->>'requiredApproverRole',
       false, "requestedById", "updatedAt"
FROM "ApprovalRequest"
WHERE "ruleId" IS NULL AND "workflowPolicy" IS NOT NULL;

ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_policy_source_check";

UPDATE "ApprovalRequest"
SET "ruleId" = 'studio-snapshot:' || "id"
WHERE "ruleId" IS NULL AND "workflowPolicy" IS NOT NULL;

ALTER TABLE "ApprovalRequest" ALTER COLUMN "ruleId" SET NOT NULL;
