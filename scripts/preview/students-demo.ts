import "dotenv/config";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { getDb } from "../../lib/db";
import { withSettingsSnapshot } from "../../lib/settings";
import { getEnv } from "../../lib/env";
import { currentLegal } from "../../lib/auth/legal";
import { grantAccess } from "../../lib/admin/grants";
import {
  loadLesson,
  answerGap,
  startTest,
  answerQuestion,
} from "../../lib/lessons/service";
import { getReviewQueue, revealCard, rateCard } from "../../lib/srs/service";
import { indexTopic } from "../../lib/tutor/indexing";
import { prepareTurn, executeTurn } from "../../lib/tutor/service";
import { MockLLMProvider } from "../../lib/llm";
import { lockTopicForChange } from "../../lib/content/locks";
import { recordInitialTopicRevision } from "../../lib/content/drafts";
import { ensureDentalDemo } from "./dental-demo";
import { ensureDemoStudyGroup } from "./study-group";
import {
  studentProfiles,
  studentPlan,
  assertStudentPreview,
  demoStudentId,
  demoCorrectCount,
  type DemoProfile,
} from "./student-profiles";
import type { Gap, Question } from "../../lib/generated/prisma/client";
import type { LessonGap } from "../../lib/lessons/types";
import { optionsFromJSON } from "../../lib/lessons/public";
async function hasActivity(userId: string) {
  const [row] = await getDb().$queryRaw<{ exists: boolean }[]>`SELECT EXISTS(
    SELECT 1 FROM "GapAttempt" WHERE "userId"=${userId} UNION ALL SELECT 1 FROM "GapAnswer" WHERE "userId"=${userId}
    UNION ALL SELECT 1 FROM "TopicProgress" WHERE "userId"=${userId} UNION ALL SELECT 1 FROM "TestRun" WHERE "userId"=${userId}
    UNION ALL SELECT 1 FROM "Card" WHERE "userId"=${userId} UNION ALL SELECT 1 FROM "TutorConversation" WHERE "userId"=${userId}
  ) AS exists`;
  return row.exists;
}
function gapSubmission(gap: Gap, publicGap: LessonGap, correct: boolean) {
  if (gap.answerType === "SHORT_TEXT")
    return {
      text: correct ? (gap.acceptedAnswers[0] ?? gap.answer) : "демо-ошибка",
    };
  const values = gap.correctAnswers.length ? gap.correctAnswers : [gap.answer],
    right = publicGap.options.filter((o) => values.includes(o.text));
  return {
    optionIds: correct
      ? right.map((o) => o.id)
      : [
          publicGap.options.find((o) => !values.includes(o.text))?.id ??
            right[0].id,
        ],
  };
}
function testSubmission(question: Question, correct: boolean) {
  if (question.answerType === "SHORT_TEXT")
    return { text: correct ? question.acceptedAnswers[0] : "демо-ошибка" };
  const options = optionsFromJSON(question.options);
  return {
    optionIds: correct
      ? question.correctOptionIds
      : [
          options.find((o) => !question.correctOptionIds.includes(o.id))?.id ??
            options[0].id,
        ],
  };
}
async function dentalPreview() {
  const db = getDb();
  let subject = await db.subject.findUnique({
    where: { slug: "progress-dental-demo" },
  });
  if (!subject)
    subject = await db.subject.create({
      data: {
        slug: "progress-dental-demo",
        title: "Стоматология — демонстрация прогресса",
        shortDescription:
          "Демонстрационный материал без экспертного подтверждения. Для проверки интерфейса.",
        courses: [1, 2, 3],
        status: "PUBLISHED",
      },
    });
  let section = await db.section.findFirst({
    where: { subjectId: subject.id },
    orderBy: { id: "asc" },
  });
  if (!section)
    section = await db.section.create({
      data: { subjectId: subject.id, title: "Учебная демонстрация" },
    });
  const topic = await ensureDentalDemo({
    subjectId: subject.id,
    sectionId: section.id,
  });
  // A dedicated preview copy: retain needsExpertReview=true; never approve or alter the author's original draft.
  if (
    topic.version === 0 &&
    topic.editRevision === 0 &&
    topic.status === "DRAFT"
  )
    await db.$transaction(async (tx) => {
      await lockTopicForChange(tx, topic.id);
      await tx.topic.update({
        where: { id: topic.id },
        data: {
          status: "PUBLISHED",
          version: 1,
          publishedAt: new Date(),
          draftState: "CLEAN",
        },
      });
      await tx.question.updateMany({
        where: { topicId: topic.id, archivedAt: null },
        data: { publishedAt: new Date() },
      });
      await recordInitialTopicRevision(tx, topic.id);
    });
}
async function shiftTopic(
  userId: string,
  topicId: string,
  started: Date,
  target: Date,
) {
  const db = getDb(),
    offset = +target - +started;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`WITH ranked AS(SELECT a.id,row_number() OVER(ORDER BY a."createdAt",a.id) AS n FROM "GapAttempt" a JOIN "Gap" g ON g.id=a."gapId" WHERE a."userId"=${userId} AND g."topicId"=${topicId}) UPDATE "GapAttempt" a SET "createdAt"=${target}::timestamp+r.n*interval '25 seconds' FROM ranked r WHERE r.id=a.id`;
    await tx.$executeRaw`UPDATE "GapAnswer" a SET "createdAt"=(SELECT min(p."createdAt") FROM "GapAttempt" p WHERE p."gapId"=a."gapId" AND p."userId"=a."userId") FROM "Gap" g WHERE g.id=a."gapId" AND g."topicId"=${topicId} AND a."userId"=${userId}`;
    await tx.$executeRaw`UPDATE "Card" SET "createdAt"="createdAt"+${offset}*interval '1 millisecond',"dueAt"="dueAt"+${offset}*interval '1 millisecond' WHERE "userId"=${userId} AND "topicId"=${topicId}`;
    const runs = await tx.testRun.findMany({
      where: { userId, topicId },
      select: { id: true, total: true },
    });
    for (const run of runs) {
      const begin = new Date(+target + 600000),
        end = new Date(+begin + Math.max(240, run.total * 35) * 1000);
      await tx.testRun.update({
        where: { id: run.id },
        data: { startedAt: begin, finishedAt: end },
      });
      await tx.$executeRaw`WITH ranked AS(SELECT id,row_number() OVER(ORDER BY "createdAt",id) AS n FROM "QuestionAttempt" WHERE "testRunId"=${run.id}) UPDATE "QuestionAttempt" a SET "createdAt"=${begin}::timestamp+r.n*interval '30 seconds' FROM ranked r WHERE r.id=a.id`;
    }
    await tx.topicProgress.updateMany({
      where: { userId, topicId },
      data: { lastOpenedAt: new Date(+target + 1200000) },
    });
    await tx.$executeRaw`UPDATE "TopicProgress" SET "completedAt"=CASE WHEN "completedAt" IS NULL THEN NULL ELSE ${target}::timestamp+interval '20 minutes' END WHERE "userId"=${userId} AND "topicId"=${topicId}`;
    await tx.$executeRaw`UPDATE "Event" SET "createdAt"="createdAt"+${offset}*interval '1 millisecond' WHERE "userId"=${userId} AND "createdAt">=${started}`;
  });
}
async function seedStudent(
  profile: DemoProfile,
  ownerId: string,
  topicIds: string[],
  now: Date,
  legal: Awaited<ReturnType<typeof currentLegal>>,
) {
  const db = getDb();
  let user =
    (await db.user.findUnique({
      where: { id: demoStudentId(profile.index) },
    })) ?? (await db.user.findUnique({ where: { email: profile.email } }));
  if (
    user &&
    (user.role !== "USER" ||
      user.blockedAt ||
      user.deletedAt ||
      (await hasActivity(user.id)))
  )
    return false;
  if (!user)
    user = await db.user.create({
      data: {
        id: demoStudentId(profile.index),
        email: profile.email,
        emailVerifiedAt: new Date(),
        name: profile.name,
        role: "USER",
        createdAt: new Date(
          +now - (profile.kind === "new" ? 1 : 30) * 86400000,
        ),
        university: "Вымышленный учебный стенд (демо)",
        course: 1,
        ...(profile.index <= 3
          ? {
              consentPdAt: new Date(),
              consentPdVersion: legal.consent.version,
              offerVersion: legal.offer.version,
            }
          : {}),
      },
    });
  const actor = { userId: user.id };
  for (const subject of await db.subject.findMany({
    where: {
      topic_subjectId: { some: { id: { in: topicIds }, isFree: false } },
    },
    select: { id: true },
  }))
    await grantAccess(ownerId, user.id, {
      requestId: randomUUID(),
      subjectId: subject.id,
      days: 90,
      reason: "демо",
    });
  // Start with platform lessons; the dental example is included in multi-lesson profiles.
  const plan = studentPlan(profile, topicIds.length);
  for (const item of plan) {
    const topicId = topicIds[item.topicIndex],
      started = new Date(),
      lesson = await loadLesson(topicId, actor);
    const gaps = await db.gap.findMany({
      where: { topicId, archivedAt: null },
      orderBy: { order: "asc" },
    });
    for (const [index, gap] of gaps.entries())
      await answerGap(
        gap.id,
        gapSubmission(
          gap,
          lesson.gaps.find((g) => g.id === gap.id)!,
          index / gaps.length < profile.score,
        ),
        lesson.version,
        actor,
      );
    const test = await startTest(topicId, lesson.version, actor),
      questions = await db.question.findMany({
        where: { topicId, archivedAt: null, publishedAt: { not: null } },
        orderBy: { order: "asc" },
      });
    for (const [index, q] of questions.entries())
      await answerQuestion(
        topicId,
        test.runId!,
        q.id,
        testSubmission(q, index < demoCorrectCount(profile, questions.length)),
        actor,
      );
    for (let round = 0; round < item.practiceRounds; round++)
      for (const gap of gaps.slice(0, 3))
        await answerGap(
          gap.id,
          gapSubmission(
            gap,
            lesson.gaps.find((g) => g.id === gap.id)!,
            false,
          ),
          lesson.version,
          actor,
          true,
        );
    await shiftTopic(
      user.id,
      topicId,
      started,
      new Date(+now - item.daysAgo * 86400000 - 1800000),
    );
  }
  const reviewTime = new Date(+now - profile.lastDaysAgo * 86400000 - 300000),
    queue = await getReviewQueue(user.id, reviewTime);
  for (const card of queue.cards.slice(
    0,
    profile.kind === "excellent" ? 12 : 3,
  )) {
    await revealCard(
      user.id,
      card.id,
      card.revision,
      card.topicVersion,
      reviewTime,
    );
    await rateCard(
      user.id,
      card.id,
      card.revision,
      card.topicVersion,
      profile.kind === "excellent"
        ? "EASY"
        : profile.kind === "lagging" || profile.kind === "repeated"
          ? "HARD"
          : "GOOD",
      reviewTime,
    );
  }
  if (profile.index <= 3 && getEnv().LLM_PROVIDER === "mock") {
    const topic = await db.topic.findUniqueOrThrow({
        where: { id: topicIds[0] },
      }),
      provider = new MockLLMProvider(1536);
    await indexTopic(
      { topicId: topic.id, subjectId: topic.subjectId, version: topic.version },
      provider,
    );
    const turn = await prepareTurn(
      {
        kind: "question",
        text: "Как учиться на платформе?",
        topicId: topic.id,
        requestId: randomUUID(),
      },
      actor,
    );
    await executeTurn(turn, () => {}, undefined, provider);
    await db.$executeRaw`UPDATE "TutorMessage" SET "createdAt"=${reviewTime} FROM "TutorConversation" c WHERE c.id="TutorMessage"."conversationId" AND c."userId"=${user.id}`;
    await db.tutorConversation.updateMany({
      where: { userId: user.id },
      data: { createdAt: reviewTime },
    });
  }
  return true;
}
export async function ensureDemoStudents(now = new Date()) {
  assertStudentPreview(process.env.DATABASE_URL, process.env.NODE_ENV);
  return withSettingsSnapshot(async () => {
    const result = await seedDemoStudents(now);
    await ensureDemoStudyGroup(now);
    return result;
  });
}
async function seedDemoStudents(now: Date) {
  const mutex = new Client({ connectionString: process.env.DATABASE_URL });
  await mutex.connect();
  try {
    await mutex.query(
      "SELECT pg_advisory_lock(hashtextextended('preview:students',0))",
    );
    const profiles = studentProfiles(),
      db = getDb();
    const existing = await db.user.findMany({
      where: {
        OR: [
          { email: { in: profiles.map((p) => p.email) } },
          { id: { in: profiles.map((p) => demoStudentId(p.index)) } },
        ],
      },
      select: { id: true, email: true },
    });
    if (
      profiles.every((p) =>
        existing.some(
          (u) => u.id === demoStudentId(p.index) || u.email === p.email,
        ),
      ) &&
      (await Promise.all(existing.map((u) => hasActivity(u.id)))).every(Boolean)
    )
      return { created: 0, skipped: 12 };
    const owner = await db.user.findUniqueOrThrow({
      where: { email: "owner@example.ru" },
    });
    await dentalPreview();
    const topics = await db.topic.findMany({
      where: {
        status: "PUBLISHED",
        subject: {
          status: "PUBLISHED",
          slug: {
            in: ["platform-demo", "learning-demo", "progress-dental-demo"],
          },
        },
      },
      select: { id: true, slug: true, subject: { select: { slug: true } } },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    });
    if (!topics.length)
      throw new Error("Create preview lessons before demo students");
    // Dental comes second, so at-risk profiles with two lessons include it too.
    topics.sort((a, b) => {
      const rank = (t: typeof a) =>
        t.subject.slug === "platform-demo" && t.slug === "first-lesson"
          ? 0
          : t.subject.slug === "progress-dental-demo"
            ? 1
            : 2;
      return rank(a) - rank(b) || a.id.localeCompare(b.id);
    });
    const legal = await currentLegal();
    let created = 0;
    for (const profile of profiles)
      if (
        await seedStudent(
          profile,
          owner.id,
          topics.map((t) => t.id),
          now,
          legal,
        )
      )
        created++;
    return { created, skipped: 12 - created };
  } finally {
    await mutex.query(
      "SELECT pg_advisory_unlock(hashtextextended('preview:students',0))",
    );
    await mutex.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(await ensureDemoStudents());
  await getDb().$disconnect();
}
