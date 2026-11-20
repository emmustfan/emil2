import { getDb } from "../db";
import { Prisma } from "../generated/prisma/client";
import { assertCanViewStudent } from "./access";
import { activitySQL, visibleTopic } from "./queries";
import type { ContentReader } from "../org";
import { topicVideoIds } from "../video/catalog";
import { videoCoverage, videoMethod } from "./video";
import { progressSettings, readProgressRows } from "./summary";
import { isLagging } from "./policy";
import { snapshotReader } from "./snapshots";
export async function studentProgress(
  studentId: string,
  options: {
    viewerId: ContentReader | null | undefined;
    subjectId?: string;
    groupId?: string;
  },
  now = new Date(),
) {
  return getDb().$transaction(
    async (db) => {
      const user = (await assertCanViewStudent(
        options.viewerId,
        studentId,
        options.subjectId,
        db,
        options.groupId,
      ))!;
      const pair = options.groupId
        ? await db.groupSubject.findUniqueOrThrow({
            where: {
              groupId_subjectId: {
                groupId: options.groupId,
                subjectId: options.subjectId!,
              },
            },
            select: {
              group: { select: { id: true, name: true } },
              subject: { select: { id: true, title: true } },
            },
          })
        : null;
      const group = pair?.group ?? null;
      const deleted = !!(user.deletedAt || user.anonymizedAt);
      const identity = {
        id: user.id,
        name: user.name ?? user.email ?? "Без имени",
        email: group ? null : user.email,
        studentNumber: group ? user.studentNumber : null,
        deleted,
        timezone: user.timezone,
      };
      await db.studentDataAccess.create({
        data: {
          viewerId:
            typeof options.viewerId === "string"
              ? options.viewerId
              : options.viewerId!.id,
          studentId,
          subjectId: options.subjectId ?? null,
          groupId: group?.id ?? null,
          view: "student_card",
        },
      });
      // A deletion can be pending while storage cleanup is in progress.
      if (pair && deleted)
        return {
          user: identity,
          group,
          subjects: [pair.subject],
          subjectId: pair.subject.id,
          summary: {
            id: studentId,
            name: identity.name,
            email: null,
            subjects: pair.subject.title,
            completed: 0,
            totalTopics: 0,
            average: null,
            due: 0,
            overdue: 0,
            lastActivity: null,
            lagging: false,
          },
          review: {
            total: 0,
            due: 0,
            overdue: 0,
            ratings: { HARD: 0, GOOD: 0, EASY: 0 },
          },
          activity: [],
          tutor: { total: 0, topics: [] },
          topics: [],
        };
      const settings = await progressSettings(),
        start = new Date(+now - 29 * 86400000);
      start.setUTCHours(0, 0, 0, 0);
      const scope = options.subjectId
        ? Prisma.sql`AND a."subjectId"=${options.subjectId}`
        : Prisma.empty;
      const [subjects] = await db.$queryRaw<
        { subjects: { id: string; title: string }[]; topicIds: string[] }[]
      >(Prisma.sql`
      WITH activity AS (${activitySQL()})
      SELECT COALESCE((SELECT jsonb_agg(s ORDER BY s.title) FROM(
        SELECT s.id,s.title FROM "Subject" s WHERE ${
          !user.canViewAllSubjects
            ? Prisma.sql`s.id=${options.subjectId}`
            : Prisma.sql`EXISTS(SELECT 1 FROM activity a WHERE a."subjectId"=s.id AND a."userId"=${studentId})`
        })s),'[]'::jsonb) AS subjects,
      COALESCE((SELECT array_agg(DISTINCT a."topicId") FILTER(WHERE a."topicId" IS NOT NULL) FROM activity a WHERE a."userId"=${studentId} ${scope}),ARRAY[]::text[]) AS "topicIds"
    `);
      const topicScope = {
        subjectId: options.subjectId
          ? options.subjectId
          : { in: subjects.subjects.map((s) => s.id) },
      };
      const topics = await db.topic.findMany({
        where: {
          ...topicScope,
          OR: [visibleTopic, { id: { in: subjects.topicIds } }],
        },
        select: {
          id: true,
          subjectId: true,
          title: true,
          slug: true,
          version: true,
          contentMd: true,
          status: true,
          needsExpertReview: true,
          order: true,
          subject: { select: { title: true, slug: true } },
        },
        orderBy: [{ subjectId: "asc" }, { order: "asc" }, { id: "asc" }],
      });
      const topicIds = topics.map((t) => t.id),
        where = { topicId: { in: topicIds } };
      const [
        gaps,
        questions,
        progress,
        firstAnswers,
        runs,
        cards,
        revisions,
        tutor,
        days,
        summary,
        videos,
      ] = await Promise.all([
        db.gap.findMany({ where, orderBy: [{ order: "asc" }, { id: "asc" }] }),
        db.question.findMany({
          where,
          orderBy: [{ order: "asc" }, { id: "asc" }],
        }),
        db.topicProgress.findMany({ where: { userId: studentId, ...where } }),
        db.gapAnswer.findMany({ where: { userId: studentId, gap: where } }),
        db.testRun.findMany({
          where: { userId: studentId, ...where },
          include: {
            questionAttempt_testRunId: { orderBy: { createdAt: "asc" } },
          },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        }),
        db.card.findMany({
          where: { userId: studentId, ...where },
          select: {
            id: true,
            topicId: true,
            suspended: true,
            dueAt: true,
            reviewLog_cardId: {
              where: { reviewedAt: { gte: start, lte: now } },
              select: { rating: true, reviewedAt: true },
            },
          },
        }),
        db.topicRevision.findMany({ where }),
        db.$queryRaw<{ topicId: string | null; count: number }[]>(
          Prisma.sql`SELECT c."topicId",count(*)::int AS count FROM "TutorConversation" c JOIN "TutorMessage" m ON m."conversationId"=c.id WHERE c."userId"=${studentId} AND m.role='USER' ${options.subjectId ? Prisma.sql`AND c."subjectId"=${options.subjectId}` : Prisma.empty} GROUP BY c."topicId"`,
        ),
        db.$queryRaw<{ day: string; count: number }[]>(
          Prisma.sql`WITH activity AS (${activitySQL(false)}) SELECT to_char(a.at,'YYYY-MM-DD') AS day,count(*)::int AS count FROM activity a WHERE a."userId"=${studentId} ${scope} AND a.at>=${start} AND a.at<=${now} GROUP BY day ORDER BY day`,
        ),
        readProgressRows(
          db,
          {
            q: "",
            filter: "all",
            page: 1,
            sort: "name",
            direction: "asc",
            studentId,
            subjectId: options.subjectId,
          },
          settings,
          now,
        ),
        db.videoLecture.findMany({
          where,
          select: {
            id: true,
            topicId: true,
            title: true,
            durationSec: true,
            archivedAt: true,
            progress: {
              where: { userId: studentId },
              select: {
                watchedSec: true,
                selfReported: true,
                completedAt: true,
              },
            },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ]);
      const attempts = await db.gapAttempt.findMany({
        where: { userId: studentId, gapId: { in: gaps.map((g) => g.id) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const historical = snapshotReader(revisions),
        daily = new Map(days.map((d) => [d.day, d.count]));
      const activity = Array.from({ length: 30 }, (_, i) => {
        const day = new Date(+start + i * 86400000).toISOString().slice(0, 10);
        return { day, count: daily.get(day) ?? 0 };
      });
      const ratings = { HARD: 0, GOOD: 0, EASY: 0 };
      for (const card of cards)
        for (const log of card.reviewLog_cardId) ratings[log.rating]++;
      const summaryRow = summary.items[0];
      if (summaryRow)
        summaryRow.lagging = isLagging(
          summaryRow.completed,
          summaryRow.totalTopics,
          summaryRow.lastActivity ? new Date(summaryRow.lastActivity) : null,
          user.createdAt,
          now,
          settings,
        );
      return {
        user: identity,
        group,
        subjects: subjects.subjects,
        subjectId: options.subjectId ?? null,
        summary: group
          ? { ...summaryRow, name: identity.name, email: null }
          : summaryRow,
        review: {
          total: cards.length,
          due: summary.items[0]?.due ?? 0,
          overdue: summary.items[0]?.overdue ?? 0,
          ratings,
        },
        activity,
        tutor: {
          total: tutor.reduce((sum, t) => sum + t.count, 0),
          topics: tutor,
        },
        topics: topics.map(({ contentMd, ...t }) => {
          const linkedVideos = topicVideoIds(contentMd);
          const topicRuns = runs
            .filter((r) => r.topicId === t.id)
            .map((r) => ({
              id: r.id,
              mode: r.mode,
              at: r.startedAt.toISOString(),
              score: r.score,
              finished: !!r.finishedAt,
              seconds: r.finishedAt
                ? Math.round((+r.finishedAt - +r.startedAt) / 1000)
                : null,
              version: r.topicVersion,
              oldVersion: r.topicVersion !== t.version,
              answers: r.questionAttempt_testRunId.flatMap((a) => {
                const q = questions.find((q) => q.id === a.questionId);
                if (!q) return [];
                const snapshot = historical.question(
                  q,
                  r.topicVersion,
                  t.version,
                );
                return [
                  {
                    id: a.id,
                    videoId: snapshot.videoId,
                    at: a.createdAt.toISOString(),
                    stem: snapshot.stem,
                    chosen:
                      a.chosenText !== null
                        ? [a.chosenText]
                        : a.chosenOptionIds.map(
                            (id) =>
                              snapshot.options.find((o) => o.id === id)?.text ??
                              id,
                          ),
                    correct: snapshot.correct,
                    isCorrect: a.isCorrect,
                  },
                ];
              }),
            }));
          const videoAnswers = topicRuns
            .filter((r) => r.mode === "VIDEO")
            .flatMap((r) =>
              r.answers.map((a) => ({
                ...a,
                version: r.version,
                oldVersion: r.oldVersion,
              })),
            );
          return {
            ...t,
            progress: progress.find((p) => p.topicId === t.id) ?? null,
            gaps: gaps
              .filter((g) => g.topicId === t.id)
              .map((g) => {
                const first = firstAnswers.find((a) => a.gapId === g.id);
                return {
                  id: g.id,
                  sentence: g.sentence,
                  archived: !!g.archivedAt,
                  correct: historical.gap(g, t.version, t.version).correct,
                  first: first
                    ? {
                        chosen: first.chosenValues.length
                          ? first.chosenValues
                          : [first.chosen],
                        correct: first.isCorrect,
                      }
                    : null,
                  attempts: attempts
                    .filter((a) => a.gapId === g.id)
                    .map((a) => ({
                      id: a.id,
                      chosen: a.chosenValues,
                      text: a.chosenText,
                      isCorrect: a.isCorrect,
                      practice: a.practice,
                      at: a.createdAt.toISOString(),
                      version: a.topicVersion,
                      oldVersion: a.topicVersion !== t.version,
                      ...historical.gap(g, a.topicVersion, t.version),
                    })),
                };
              }),
            tests: topicRuns.filter((r) => r.mode !== "VIDEO"),
            videos: videos
              .filter((v) => v.topicId === t.id)
              .flatMap((v) => {
                const answers = videoAnswers.filter((a) => a.videoId === v.id);
                const watch = v.progress[0];
                if (
                  (!linkedVideos.includes(v.id) || v.archivedAt) &&
                  !watch &&
                  !answers.length
                )
                  return [];
                return [
                  {
                    id: v.id,
                    title: v.title,
                    method: videoMethod(watch),
                    coverage:
                      watch?.selfReported && !watch.watchedSec
                        ? null
                        : videoCoverage(watch?.watchedSec ?? 0, v.durationSec),
                    completed: !!watch?.completedAt,
                    answers,
                  },
                ];
              }),
            tutorQuestions: tutor.find((q) => q.topicId === t.id)?.count ?? 0,
          };
        }),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
}
export type StudentProgress = Awaited<ReturnType<typeof studentProgress>>;
