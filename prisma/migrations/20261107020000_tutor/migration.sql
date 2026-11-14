ALTER TABLE "ContentChunk" ADD COLUMN "topicVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "embeddingModel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TutorMessage" ADD COLUMN "requestKey" TEXT, ADD COLUMN "inputHash" TEXT, ADD COLUMN "status" TEXT NOT NULL DEFAULT 'COMPLETED', ADD COLUMN "runToken" TEXT, ADD COLUMN "leaseUntil" TIMESTAMP(3), ADD COLUMN "quotaPeriodStart" TIMESTAMP(3), ADD COLUMN "replyToId" TEXT;
CREATE UNIQUE INDEX "TutorMessage_requestKey_key" ON "TutorMessage"("requestKey");
CREATE UNIQUE INDEX "TutorMessage_replyToId_key" ON "TutorMessage"("replyToId");
CREATE INDEX "TutorMessage_status_leaseUntil_idx" ON "TutorMessage"("status","leaseUntil");
INSERT INTO "AppSetting" (key,value,"updatedAt") VALUES
('tutor.requestsPerMinute','10',now()),('tutor.timeoutMs','60000',now()),('tutor.leaseGraceMs','10000',now()),('tutor.historyMessages','6',now()),('tutor.maxTokens','1200',now()),('tutor.maxAnswerChars','12000',now()),('tutor.minSimilarity','0.15',now()),('tutor.topicBonus','0.1',now()),('tutor.candidateMultiplier','4',now()),('tutor.chunkTargetTokens','500',now()),('tutor.chunkMaxTokens','800',now()),('tutor.embeddingBatchSize','16',now()) ON CONFLICT (key) DO NOTHING;
