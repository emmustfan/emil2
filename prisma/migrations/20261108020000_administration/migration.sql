ALTER TABLE "User" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
ALTER TABLE "Plan" ADD COLUMN "editRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "manualRenewal" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "User_deletedAt_anonymizedAt_idx" ON "User"("deletedAt", "anonymizedAt");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
CREATE INDEX "TutorMessage_createdAt_feedback_idx" ON "TutorMessage"("createdAt", "feedback");
CREATE INDEX "AccessGrant_userId_expiresAt_idx" ON "AccessGrant"("userId", "expiresAt");
