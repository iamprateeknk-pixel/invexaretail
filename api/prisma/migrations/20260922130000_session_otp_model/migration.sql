-- DropIndex
DROP INDEX "UserSession_token_key";

-- DropIndex
DROP INDEX "UserSession_userId_revokedAt_idx";

-- AlterTable
ALTER TABLE "UserSession" DROP COLUMN "token",
ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "familyId" TEXT NOT NULL,
ADD COLUMN     "replacedByTokenHash" TEXT,
ADD COLUMN     "rotationCounter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpChallenge_email_purpose_consumedAt_idx" ON "OtpChallenge"("email", "purpose", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_status_idx" ON "UserSession"("userId", "status");

-- CreateIndex
CREATE INDEX "UserSession_familyId_idx" ON "UserSession"("familyId");

