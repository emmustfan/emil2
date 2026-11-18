CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImpersonationSession_tokenHash_key" ON "ImpersonationSession"("tokenHash");
CREATE INDEX "ImpersonationSession_adminId_startedAt_idx" ON "ImpersonationSession"("adminId", "startedAt");
CREATE INDEX "ImpersonationSession_targetUserId_startedAt_idx" ON "ImpersonationSession"("targetUserId", "startedAt");
