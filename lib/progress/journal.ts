import { getDb } from "../db";
import { Prisma } from "../generated/prisma/client";
import { topicVideoIds } from "../video/catalog";
import type { ContentReader } from "../org";
import { groupDirectory } from "../org/groups";
import {
  assertCanViewGroupProgress,
  progressNotFound,
  type GroupSubject,
} from "./access";
import { isLagging } from "./policy";
import { progressSettings } from "./summary";
import {
  activitySQL,
  availableCardSQL,
  cardCountsSQL,
  safeTimezoneSQL,
  visibleTopic,
  visibleTopicSQL,
} from "./queries";
import { videoMethod } from "./video";

type Db = Prisma.TransactionClient;
type Viewer = ContentReader | null | undefined;
export type JournalFilters = {
  sectionId?: string;
  removed: boolean;
  lagging: boolean;
};

export function journalFilters(input: Record<string, unknown>): JournalFilters {
  return {
    sectionId:
      typeof input.section === "string"
        ? input.section.slice(0, 128)
        : undefined,
    removed: input.removed === "1",
    lagging: input.lagging === "1",
  };
}

export async function directoryProgress(actor: ContentReader) {
  const { groups, managementGroups, faculties } = await groupDirectory(actor);
  const pairs = groups.flatMap((g) =>
    g.subjects.map(({ subject }) => [g.id, subject.id]),
  );
  const db = getDb();
  const [members, stats] = await Promise.all([
    db.groupMember.groupBy({
      by: ["groupId", "status"],
      where: {
        groupId: { in: groups.map((g) => g.id) },
        status: { in: ["ACTIVE", "PENDING"] },
        user: { role: "USER", deletedAt: null, anonymizedAt: null },
      },
      _count: { _all: true },
    }),
    pairs.length
      ? db.$queryRaw<
          { groupId: string; subjectId: string; rate: number | null }[]
        >(Prisma.sql`
        WITH pairs AS (
          SELECT * FROM unnest(${pairs.map(([id]) => id)}::text[], ${pairs.map(([, id]) => id)}::text[]) AS x("groupId","subjectId")
        ), topics AS (
          SELECT t.id,t."subjectId" FROM "Topic" t JOIN "Subject" s ON s.id=t."subjectId"
          WHERE ${visibleTopicSQL} AND t."subjectId" IN (SELECT "subjectId" FROM pairs)
        )
        SELECT x."groupId",x."subjectId",
          count(p."completedAt")::float / NULLIF(count(*),0) AS rate
        FROM pairs x JOIN topics t ON t."subjectId"=x."subjectId"
        JOIN "GroupMember" m ON m."groupId"=x."groupId" AND m.status='ACTIVE'
        JOIN "User" u ON u.id=m."userId" AND u.role='USER' AND u."deletedAt" IS NULL AND u."anonymizedAt" IS NULL
        LEFT JOIN "TopicProgress" p ON p."topicId"=t.id AND p."userId"=u.id
        GROUP BY x."groupId",x."subjectId"`)
      : [],
  ]);
  const counts = new Map(
    members.map((m) => [`${m.groupId}:${m.status}`, m._count._all]),
  );
  const rates = new Map(
    stats.map((s) => [`${s.groupId}:${s.subjectId}`, s.rate]),
  );
  return {
    faculties,
    managementGroups,
    groups: groups.map((g) => ({
      ...g,
      active: counts.get(`${g.id}:ACTIVE`) ?? 0,
      pending: counts.get(`${g.id}:PENDING`) ?? 0,
      subjects: g.subjects.map(({ subject }) => ({
        ...subject,
        rate: rates.get(`${g.id}:${subject.id}`) ?? null,
      })),
    })),
  };
}

type Person = {
  id: string;
  name: string;
  createdAt: Date;
  deleted: boolean;
  removed: boolean;
  lastActivity: Date | null;
  due: number;
  overdue: number;
};
const byName = new Intl.Collator("ru", { numeric: true });
const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

export async function readJournal(
  db: Db,
  viewer: Viewer,
  scope: GroupSubject,
  filters: JournalFilters,
  now: Date,
) {
  await assertCanViewGroupProgress(viewer, scope, db);
  const { groupId, subjectId } = scope;
  const settings = await progressSettings();
  const [pair, topicRows, people] = await Promise.all([
    db.groupSubject.findUnique({
      where: { groupId_subjectId: scope },
      select: {
        group: { select: { id: true, name: true } },
        subject: { select: { id: true, title: true } },
      },
    }),
    db.topic.findMany({
      where: { subjectId, ...visibleTopic },
      select: {
        id: true,
        title: true,
        contentMd: true,
        section: { select: { id: true, title: true } },
        videos: {
          where: { archivedAt: null },
          select: { id: true, title: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [
        { section: { order: "asc" } },
        { sectionId: "asc" },
        { order: "asc" },
        { id: "asc" },
      ],
    }),
    db.$queryRaw<Person[]>(Prisma.sql`
      WITH people AS (
        SELECT u.id,u."createdAt",${safeTimezoneSQL} AS timezone,
          (u."deletedAt" IS NOT NULL OR u."anonymizedAt" IS NOT NULL) AS deleted,
          (m.status='REMOVED' OR u."deletedAt" IS NOT NULL OR u."anonymizedAt" IS NOT NULL) AS removed,
          CASE WHEN u."deletedAt" IS NOT NULL OR u."anonymizedAt" IS NOT NULL THEN 'Удалённый пользователь'
            ELSE COALESCE(NULLIF(concat_ws(' ',u."lastName",u."firstName",u."middleName"),''),u.name,'Без имени') END AS name
        FROM "GroupMember" m JOIN "User" u ON u.id=m."userId"
        WHERE m."groupId"=${groupId} AND u.role='USER' AND
          ${
            filters.removed
              ? Prisma.sql`m.status IN ('ACTIVE','REMOVED')`
              : Prisma.sql`m.status='ACTIVE' AND u."deletedAt" IS NULL AND u."anonymizedAt" IS NULL`
          }
      ), activity AS (${activitySQL()}), recent AS (
        SELECT a."userId",max(a.at) AS at FROM activity a JOIN people u ON u.id=a."userId" AND NOT u.deleted
        WHERE a."subjectId"=${subjectId} GROUP BY a."userId"
      ), cards AS (
        SELECT c."userId",${cardCountsSQL(now)} FROM "Card" c
        JOIN people u ON u.id=c."userId" AND NOT u.deleted
        JOIN "Topic" t ON t.id=c."topicId" JOIN "Subject" s ON s.id=t."subjectId"
        WHERE c."subjectId"=${subjectId} AND ${availableCardSQL(now, settings.graceDays)}
        GROUP BY c."userId"
      )
      SELECT u.id,u.name,u."createdAt",u.deleted,u.removed,a.at AS "lastActivity",
        COALESCE(c.due,0) AS due,COALESCE(c.overdue,0) AS overdue
      FROM people u LEFT JOIN recent a ON a."userId"=u.id LEFT JOIN cards c ON c."userId"=u.id
    `),
  ]);
  if (!pair) return progressNotFound();
  const topics = topicRows.map(({ contentMd, videos, ...t }) => {
    const linked = new Set(topicVideoIds(contentMd));
    return { ...t, videos: videos.filter((v) => linked.has(v.id)) };
  });
  const sections = [
    ...new Map(
      topics.flatMap((t) => {
        return t.section ? [[t.section.id, t.section] as const] : [];
      }),
    ).values(),
  ];
  const visible = topics.filter(
    (t) => !filters.sectionId || t.section?.id === filters.sectionId,
  );
  const userIds = people.filter((p) => !p.deleted).map((p) => p.id);
  const [progressRows, watchRows] = await Promise.all([
    db.topicProgress.findMany({
      where: {
        userId: { in: userIds },
        topicId: { in: topics.map((t) => t.id) },
      },
    }),
    db.videoProgress.findMany({
      where: {
        userId: { in: userIds },
        videoId: { in: visible.flatMap((t) => t.videos.map((v) => v.id)) },
      },
      select: {
        userId: true,
        videoId: true,
        watchedSec: true,
        selfReported: true,
      },
    }),
  ]);
  const progress = new Map(
    progressRows.map((p) => [`${p.userId}:${p.topicId}`, p]),
  );
  const watches = new Map(
    watchRows.map((p) => [`${p.userId}:${p.videoId}`, p]),
  );
  people.sort(
    (a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id),
  );
  const rows = people.flatMap(({ createdAt, ...person }) => {
    const completed = topics.filter(
      (t) => progress.get(`${person.id}:${t.id}`)?.completedAt,
    ).length;
    const lagging =
      !person.deleted &&
      isLagging(
        completed,
        topics.length,
        person.lastActivity,
        createdAt,
        now,
        settings,
      );
    if (filters.lagging && !lagging) return [];
    const cells = visible.map((topic) => {
      const record = progress.get(`${person.id}:${topic.id}`);
      return {
        state: record?.completedAt
          ? "Завершена"
          : record
            ? "В процессе"
            : "Не начата",
        completed: !!record?.completedAt,
        accuracy: record?.gapsAnswered
          ? record.gapsCorrect / record.gapsAnswered
          : null,
        score: record?.testBestScore ?? null,
        videos: person.deleted
          ? []
          : topic.videos.map((video) => ({
              title: video.title,
              method: videoMethod(watches.get(`${person.id}:${video.id}`)),
            })),
      };
    });
    return [
      {
        ...person,
        lagging,
        cells,
        completed,
        total: topics.length,
        average: average(
          topics.flatMap((t) => {
            const score = progress.get(`${person.id}:${t.id}`)?.testBestScore;
            return score == null ? [] : [score];
          }),
        ),
      },
    ];
  });
  const counted = rows.filter((row) => !row.deleted);
  return {
    ...pair,
    sections,
    rows,
    topics: visible,
    totals: visible.map((_, i) => ({
      completion: counted.length
        ? counted.filter((row) => row.cells[i].completed).length /
          counted.length
        : null,
      average: average(counted.flatMap((row) => row.cells[i].score ?? [])),
    })),
    thresholds: {
      minCompletionPercent: settings.minCompletionPercent,
      inactiveDays: settings.inactiveDays,
    },
  };
}

export function groupJournal(
  viewer: Viewer,
  scope: GroupSubject,
  filters: JournalFilters,
  now = new Date(),
) {
  return getDb().$transaction(
    (db) => readJournal(db, viewer, scope, filters, now),
    {
      isolationLevel: "RepeatableRead",
    },
  );
}

export type GroupJournal = Awaited<ReturnType<typeof groupJournal>>;
