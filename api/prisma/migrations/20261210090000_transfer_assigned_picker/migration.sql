-- Transfer picker assignment: additive only - one nullable column and an index, no existing data touched.
-- Existing transfers keep NULL, which means "any picker at the source location", the behaviour before this column.
ALTER TABLE "Transfer" ADD COLUMN "assignedPickerId" TEXT;

CREATE INDEX "Transfer_assignedPickerId_status_idx" ON "Transfer"("assignedPickerId", "status");
