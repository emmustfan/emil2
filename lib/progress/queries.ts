import { Prisma } from "../generated/prisma/client";
/** Canonical activity sources, one row per recorded action (no tutor content). */
export function activitySQL(includeProgress = true) {
  return Prisma.sql`
  SELECT a."userId",t."subjectId",t.id AS "topicId",a."createdAt" AS at FROM "GapAttempt" a JOIN "Gap" g ON g.id=a."gapId" JOIN "Topic" t ON t.id=g."topicId"
  UNION ALL SELECT r."userId",r."subjectId",r."topicId",r."startedAt" FROM "TestRun" r WHERE r."userId" IS NOT NULL
  UNION ALL SELECT r."userId",r."subjectId",r."topicId",a."createdAt" FROM "QuestionAttempt" a JOIN "TestRun" r ON r.id=a."testRunId" WHERE r."userId" IS NOT NULL
  UNION ALL SELECT c."userId",c."subjectId",c."topicId",l."reviewedAt" FROM "ReviewLog" l JOIN "Card" c ON c.id=l."cardId" WHERE c."userId" IS NOT NULL
  UNION ALL SELECT c."userId",c."subjectId",c."topicId",m."createdAt" FROM "TutorMessage" m JOIN "TutorConversation" c ON c.id=m."conversationId" WHERE c."userId" IS NOT NULL AND m.role='USER'
  UNION ALL SELECT e."userId",t."subjectId",t.id,e."createdAt" FROM "Event" e JOIN "Topic" t ON t.id=e.props->>'topicId' WHERE e."userId" IS NOT NULL AND e.name='topic_opened'
  UNION ALL SELECT p."userId",t."subjectId",t.id,p."updatedAt" FROM "VideoProgress" p JOIN "VideoLecture" v ON v.id=p."videoId" JOIN "Topic" t ON t.id=v."topicId"
  ${includeProgress ? Prisma.sql`UNION ALL SELECT p."userId",t."subjectId",t.id,p."lastOpenedAt" FROM "TopicProgress" p JOIN "Topic" t ON t.id=p."topicId"` : Prisma.empty}
`;
}
/** Matches learning access and SRS source eligibility; does not apply the daily new-card cap. Aliases c,t,s. */
export function availableCardSQL(now: Date, graceDays: number) {
  return Prisma.sql`
  NOT c.suspended AND t.status='PUBLISHED' AND s.status='PUBLISHED' AND (
    t."isFree" OR EXISTS(SELECT 1 FROM "AccessGrant" g WHERE g."userId"=c."userId" AND (g."subjectId" IS NULL OR g."subjectId"=c."subjectId") AND g."expiresAt">${now})
    OR EXISTS(SELECT 1 FROM "GroupMember" m JOIN "StudyGroup" g ON g.id=m."groupId" JOIN "Faculty" f ON f.id=g."facultyId" JOIN "GroupSubject" gs ON gs."groupId"=g.id WHERE m."userId"=c."userId" AND m.status='ACTIVE' AND gs."subjectId"=c."subjectId" AND g."archivedAt" IS NULL AND f."archivedAt" IS NULL)
    OR EXISTS(SELECT 1 FROM "Subscription" sub JOIN "Plan" p ON p.id=sub."planId" WHERE sub."userId"=c."userId" AND sub.status IN ('ACTIVE','PAST_DUE') AND sub."currentPeriodStart"<=${now} AND sub."currentPeriodEnd"+CASE WHEN sub.status='PAST_DUE' THEN ${graceDays}*interval '1 day' ELSE interval '0 day' END>${now} AND (p.kind='ALL_SUBJECTS' OR (p.kind='SUBJECT' AND sub."subjectId"=c."subjectId")))
  ) AND ((c.source='GAP' AND EXISTS(SELECT 1 FROM "Gap" g WHERE g.id=c."gapId" AND g."archivedAt" IS NULL)) OR (c.source='QUESTION' AND EXISTS(SELECT 1 FROM "Question" q WHERE q.id=c."questionId" AND q."archivedAt" IS NULL AND q."publishedAt" IS NOT NULL)))
`;
}
export const visibleTopicSQL = Prisma.sql`t.status='PUBLISHED' AND NOT t."needsExpertReview" AND s.status='PUBLISHED'`;

export const safeTimezoneSQL = Prisma.sql`CASE WHEN u.timezone IN (SELECT name FROM pg_timezone_names) THEN u.timezone ELSE 'Europe/Moscow' END`;

export function cardCountsSQL(now: Date) {
  return Prisma.sql`count(*) FILTER(WHERE c."dueAt"<=${now})::int AS due,
    count(*) FILTER(WHERE c."dueAt"<date_trunc('day',${now}::timestamptz AT TIME ZONE u.timezone) AT TIME ZONE u.timezone AT TIME ZONE 'UTC')::int AS overdue`;
}

export const visibleTopic = {
  status: "PUBLISHED",
  needsExpertReview: false,
  subject: { status: "PUBLISHED" },
} as const;
