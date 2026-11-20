import { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { getSetting } from "../settings";
import { assertCanViewStudent } from "./access";
import { progressFilters } from "./policy";
import {
  activitySQL,
  availableCardSQL,
  cardCountsSQL,
  safeTimezoneSQL,
  visibleTopicSQL,
} from "./queries";
export type ProgressRow = {
  id: string;
  name: string;
  email: string | null;
  subjects: string;
  completed: number;
  totalTopics: number;
  average: number | null;
  due: number;
  overdue: number;
  lastActivity: string | null;
  lagging: boolean;
};
const sorts = {
  name: Prisma.sql`name`,
  subjects: Prisma.sql`subjects`,
  completed: Prisma.sql`completed`,
  average: Prisma.sql`average`,
  due: Prisma.sql`due`,
  overdue: Prisma.sql`overdue`,
  lastActivity: Prisma.sql`"lastActivity"`,
};
export async function progressSettings() {
  const [size, minCompletionPercent, inactiveDays, graceDays] =
    await Promise.all([
      getSetting("progress.pageSize"),
      getSetting("progress.minCompletionPercent"),
      getSetting("progress.inactiveDays"),
      getSetting("billing.graceDays"),
    ]);
  return { size, minCompletionPercent, inactiveDays, graceDays };
}
/** Internal aggregate, used only after assertCanViewStudent by both public services. Constant query count. */
export async function readProgressRows(
  db: Prisma.TransactionClient,
  input: {
    q: string;
    filter: string;
    page: number;
    sort: keyof typeof sorts;
    direction: string;
    studentId?: string;
    subjectId?: string;
  },
  settings: Awaited<ReturnType<typeof progressSettings>>,
  now: Date,
) {
  const scope = input.subjectId
    ? Prisma.sql`AND "subjectId"=${input.subjectId}`
    : Prisma.empty;
  const [data] = await db.$queryRaw<
    { total: number; items: ProgressRow[] }[]
  >(Prisma.sql`
    WITH people AS (
      SELECT id,CASE WHEN "deletedAt" IS NOT NULL OR "anonymizedAt" IS NOT NULL THEN 'Удалённый пользователь' ELSE COALESCE(name,email,'Без имени') END AS name,
      CASE WHEN "deletedAt" IS NOT NULL OR "anonymizedAt" IS NOT NULL THEN NULL ELSE email END AS email,"createdAt",${safeTimezoneSQL} AS timezone
      FROM "User" u WHERE role='USER' AND ${input.studentId ? Prisma.sql`id=${input.studentId}` : Prisma.sql`"deletedAt" IS NULL`}
    ), activity AS (${activitySQL()}), scoped_activity AS (SELECT a.* FROM activity a JOIN people u ON u.id=a."userId" WHERE true ${scope}),
    subject_activity AS (SELECT DISTINCT "userId","subjectId" FROM scoped_activity),
    subject_totals AS (SELECT t."subjectId",count(*)::int AS n FROM "Topic" t JOIN "Subject" s ON s.id=t."subjectId" WHERE ${visibleTopicSQL} GROUP BY t."subjectId"),
    subject_stats AS (SELECT a."userId",string_agg(s.title,' · ' ORDER BY s.title) AS subjects,COALESCE(sum(n),0)::int AS total FROM subject_activity a JOIN "Subject" s ON s.id=a."subjectId" LEFT JOIN subject_totals st ON st."subjectId"=s.id GROUP BY a."userId"),
    progress_stats AS (SELECT p."userId",count(*) FILTER(WHERE p."completedAt" IS NOT NULL)::int AS completed,avg(p."testBestScore")::float AS average FROM "TopicProgress" p JOIN people u ON u.id=p."userId" JOIN "Topic" t ON t.id=p."topicId" JOIN "Subject" s ON s.id=t."subjectId" WHERE ${visibleTopicSQL} ${input.subjectId ? Prisma.sql`AND t."subjectId"=${input.subjectId}` : Prisma.empty} GROUP BY p."userId"),
    card_stats AS (SELECT c."userId",${cardCountsSQL(now)} FROM "Card" c JOIN people u ON u.id=c."userId" JOIN "Topic" t ON t.id=c."topicId" JOIN "Subject" s ON s.id=t."subjectId" WHERE ${availableCardSQL(now, settings.graceDays)} ${input.subjectId ? Prisma.sql`AND c."subjectId"=${input.subjectId}` : Prisma.empty} GROUP BY c."userId"),
    last_activity AS (SELECT "userId",max(at) AS at FROM scoped_activity GROUP BY "userId"),
    statistics AS (SELECT u.id,u.name,u.email,COALESCE(ss.subjects,'') AS subjects,${input.subjectId ? Prisma.sql`COALESCE((SELECT n FROM subject_totals WHERE "subjectId"=${input.subjectId}),0)` : Prisma.sql`COALESCE(ss.total,0)`} AS "totalTopics",COALESCE(ps.completed,0) AS completed,ps.average,COALESCE(cs.due,0) AS due,COALESCE(cs.overdue,0) AS overdue,to_char(la.at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastActivity",
      (CASE WHEN COALESCE(ss.total,0)>0 THEN COALESCE(ps.completed,0)::float/ss.total*100 ELSE 0 END<${settings.minCompletionPercent} OR COALESCE(la.at,u."createdAt")<${now}::timestamp-${settings.inactiveDays}*interval '1 day') AS lagging
      FROM people u LEFT JOIN subject_stats ss ON ss."userId"=u.id LEFT JOIN progress_stats ps ON ps."userId"=u.id LEFT JOIN card_stats cs ON cs."userId"=u.id LEFT JOIN last_activity la ON la."userId"=u.id
    ), filtered AS (SELECT * FROM statistics WHERE (name ILIKE ${"%" + input.q + "%"} OR email ILIKE ${"%" + input.q + "%"}) ${input.filter === "lagging" ? Prisma.sql`AND lagging` : Prisma.empty})
    SELECT (SELECT count(*)::int FROM filtered) AS total,COALESCE((SELECT jsonb_agg(p) FROM (SELECT * FROM filtered ORDER BY ${sorts[input.sort]} ${input.direction === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`} NULLS LAST,id ASC OFFSET ${(input.page - 1) * settings.size} LIMIT ${settings.size}) p),'[]'::jsonb) AS items
  `);
  return {
    ...data,
    page: input.page,
    pages: Math.max(1, Math.ceil(data.total / settings.size)),
    settings,
  };
}
export async function progressSummary(
  input: {
    viewerId: string | null | undefined;
    q?: string;
    filter?: string;
    page?: number;
    sort?: string;
    direction?: string;
  },
  now = new Date(),
) {
  await assertCanViewStudent(input.viewerId);
  const { viewerId, ...raw } = input;
  void viewerId;
  return readProgressRows(
    getDb(),
    progressFilters.parse(raw),
    await progressSettings(),
    now,
  );
}
