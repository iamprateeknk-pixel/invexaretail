-- Audit T-2: optional per-company business timezone (IANA name). NULL = process default.
ALTER TABLE "CompanyProfile" ADD COLUMN "timezone" TEXT;
