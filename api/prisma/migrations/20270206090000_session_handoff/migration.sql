CREATE TABLE "SessionHandoff" (
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "payload" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionHandoff_pkey" PRIMARY KEY ("codeHash")
);

CREATE INDEX "SessionHandoff_expiresAt_idx" ON "SessionHandoff"("expiresAt");
