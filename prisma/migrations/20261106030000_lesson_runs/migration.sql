-- Version pins an in-progress test to its published question set.
ALTER TABLE "TestRun" ADD COLUMN "topicVersion" INTEGER;
-- Enforce first answer even when two tabs submit concurrently.
CREATE UNIQUE INDEX "QuestionAttempt_testRunId_questionId_key" ON "QuestionAttempt"("testRunId", "questionId");
