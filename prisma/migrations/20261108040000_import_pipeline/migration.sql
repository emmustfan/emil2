ALTER TABLE "ImportJob"
  ADD COLUMN "format" TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN "partsDone" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "partsTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "runToken" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "rightsConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "sourceDeletedAt" TIMESTAMP(3);
CREATE INDEX "ImportJob_status_leaseUntil_idx" ON "ImportJob"("status", "leaseUntil");
CREATE INDEX "ImportJob_subjectId_createdAt_idx" ON "ImportJob"("subjectId", "createdAt");
