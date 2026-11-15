CREATE TABLE "GapAttempt" (
  "id" TEXT NOT NULL,
  "gapId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "topicVersion" INTEGER NOT NULL,
  "chosenValues" TEXT[] NOT NULL,
  "chosenText" TEXT,
  "isCorrect" BOOLEAN NOT NULL,
  "practice" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GapAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GapAttempt_userId_createdAt_idx" ON "GapAttempt"("userId", "createdAt");
CREATE INDEX "GapAttempt_gapId_createdAt_idx" ON "GapAttempt"("gapId", "createdAt");

INSERT INTO "GapAttempt" (id,"gapId","userId","topicVersion","chosenValues","chosenText","isCorrect",practice,"createdAt")
SELECT 'legacy-' || a.id, a."gapId", a."userId", t.version,
  CASE WHEN cardinality(a."chosenValues")>0 THEN a."chosenValues" ELSE ARRAY[a.chosen] END,
  CASE WHEN g."answerType"='SHORT_TEXT' THEN COALESCE(a."chosenValues"[1],a.chosen) ELSE NULL END,
  a."isCorrect", false, a."createdAt"
FROM "GapAnswer" a JOIN "Gap" g ON g.id=a."gapId" JOIN "Topic" t ON t.id=g."topicId"
WHERE a."userId" IS NOT NULL;

CREATE TABLE "StudentDataAccess" (
  "id" TEXT NOT NULL,
  "viewerId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "groupId" TEXT,
  "subjectId" TEXT,
  "view" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentDataAccess_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentDataAccess_studentId_createdAt_idx" ON "StudentDataAccess"("studentId", "createdAt");
