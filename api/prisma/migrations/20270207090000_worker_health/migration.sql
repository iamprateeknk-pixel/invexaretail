CREATE TABLE "WorkerHealth" (
    "release" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "outboxAt" TIMESTAMP(3),
    "importsAt" TIMESTAMP(3),
    "automationsAt" TIMESTAMP(3),
    "studioReleasesAt" TIMESTAMP(3),
    CONSTRAINT "WorkerHealth_pkey" PRIMARY KEY ("release")
);
