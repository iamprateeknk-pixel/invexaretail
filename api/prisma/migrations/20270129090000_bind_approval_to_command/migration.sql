ALTER TABLE "ApprovalRequest" ADD COLUMN "intentFingerprint" VARCHAR(64);

CREATE INDEX "ApprovalRequest_intentFingerprint_status_idx"
  ON "ApprovalRequest"("intentFingerprint", "status");
