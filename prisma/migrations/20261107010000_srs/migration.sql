ALTER TABLE "Card" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "firstShownAt" TIMESTAMP(3), ADD COLUMN "revealedAt" TIMESTAMP(3), ADD COLUMN "revealedTopicVersion" INTEGER;
CREATE INDEX "Card_userId_firstShownAt_idx" ON "Card"("userId","firstShownAt");
ALTER TABLE "ReviewLog" ADD COLUMN "cardRevision" INTEGER;
CREATE UNIQUE INDEX "ReviewLog_cardId_cardRevision_key" ON "ReviewLog"("cardId","cardRevision");
CREATE INDEX "ReviewLog_cardId_reviewedAt_idx" ON "ReviewLog"("cardId","reviewedAt");
INSERT INTO "AppSetting" (key,value,"updatedAt") VALUES ('srs.hardEasePenalty','0.2',CURRENT_TIMESTAMP),('srs.easyEaseGain','0.15',CURRENT_TIMESTAMP),('srs.queuePageSize','20',CURRENT_TIMESTAMP) ON CONFLICT (key) DO NOTHING;
-- Existing learners receive cards too. Stable IDs + source unique keys make this idempotent.
WITH settings AS (
 SELECT COALESCE((SELECT (value #>> '{}')::double precision FROM "AppSetting" WHERE key='srs.goodFirstDays' AND jsonb_typeof(value)='number' AND (CASE WHEN jsonb_typeof(value)='number' THEN (value #>> '{}')::numeric END)>0 AND (CASE WHEN jsonb_typeof(value)='number' THEN (value #>> '{}')::numeric END)<=100000),1) AS days,
 COALESCE((SELECT (value #>> '{}')::double precision FROM "AppSetting" WHERE key='srs.easeDefault' AND jsonb_typeof(value)='number' AND (CASE WHEN jsonb_typeof(value)='number' THEN (value #>> '{}')::numeric END)>0 AND (CASE WHEN jsonb_typeof(value)='number' THEN (value #>> '{}')::numeric END)<=100000),2.5) AS ease
)
INSERT INTO "Card"(id,"userId","demoSessionId",source,"gapId","subjectId","topicId",ease,"dueAt",suspended,"createdAt")
SELECT 'srs_gap_'||md5(a.id),a."userId",CASE WHEN a."userId" IS NULL THEN a."demoSessionId" ELSE NULL END,'GAP',g.id,t."subjectId",t.id,s.ease,a."createdAt"+CASE WHEN a."isCorrect" THEN s.days*INTERVAL '1 day' ELSE INTERVAL '0' END,g."archivedAt" IS NOT NULL,a."createdAt"
FROM "GapAnswer" a JOIN "Gap" g ON g.id=a."gapId" JOIN "Topic" t ON t.id=g."topicId" CROSS JOIN settings s WHERE a."userId" IS NOT NULL OR a."demoSessionId" IS NOT NULL ON CONFLICT DO NOTHING;
WITH mistakes AS (
 SELECT DISTINCT ON(r."userId",CASE WHEN r."userId" IS NULL THEN r."demoSessionId" ELSE NULL END,a."questionId") a.id,r."userId",CASE WHEN r."userId" IS NULL THEN r."demoSessionId" ELSE NULL END AS demo,q.id AS question,t.id AS topic,t."subjectId" AS subject,q."archivedAt",a."createdAt"
 FROM "QuestionAttempt" a JOIN "TestRun" r ON r.id=a."testRunId" JOIN "Question" q ON q.id=a."questionId" JOIN "Topic" t ON t.id=q."topicId"
 WHERE NOT a."isCorrect" AND(r."userId" IS NOT NULL OR r."demoSessionId" IS NOT NULL)
 ORDER BY r."userId",CASE WHEN r."userId" IS NULL THEN r."demoSessionId" ELSE NULL END,a."questionId",a."createdAt",a.id
)
INSERT INTO "Card"(id,"userId","demoSessionId",source,"questionId","subjectId","topicId",ease,"dueAt",suspended,"createdAt")
SELECT 'srs_question_'||md5(m.id),m."userId",m.demo,'QUESTION',m.question,m.subject,m.topic,COALESCE((SELECT (value #>> '{}')::double precision FROM "AppSetting" WHERE key='srs.easeDefault' AND jsonb_typeof(value)='number' AND (CASE WHEN jsonb_typeof(value)='number' THEN (value #>> '{}')::numeric END)>0 AND (CASE WHEN jsonb_typeof(value)='number' THEN (value #>> '{}')::numeric END)<=100000),2.5),m."createdAt",m."archivedAt" IS NOT NULL,m."createdAt" FROM mistakes m ON CONFLICT DO NOTHING;
UPDATE "Card" c SET "firstShownAt"=(SELECT min(l."reviewedAt") FROM "ReviewLog" l WHERE l."cardId"=c.id) WHERE EXISTS(SELECT 1 FROM "ReviewLog" l WHERE l."cardId"=c.id);
