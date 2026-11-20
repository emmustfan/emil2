import "dotenv/config";
import { randomUUID } from "node:crypto";
import { newToken, hashToken } from "../../lib/auth/crypto";
import { currentLegal } from "../../lib/auth/legal";
import { lock } from "../../lib/auth/session";
import { withTopicDraft } from "../../lib/content/drafts";
import { parseTopic } from "../../lib/content/parse";
import { getDb } from "../../lib/db";
import { academicYear } from "../../lib/groups/input";
import { currentGroupNotice } from "../../lib/groups/notice";
import {
  assertStudentPreview,
  studentPlan,
  studentProfiles,
} from "./student-profiles";

const subjectSlug = "preview-teacher-journal";
const dayMs = 86400000;

async function seed() {
  const db = getDb();
  const legal = await currentLegal();
  const now = new Date();
  const teacher = await db.user.findUniqueOrThrow({
    where: { email: "teacher@example.ru" },
    select: { id: true, role: true },
  });
  if (teacher.role !== "EDITOR" && teacher.role !== "ADMIN")
    throw new Error("Сначала запустите обычный preview с преподавателем.");
  const sample = await db.$transaction(
    async (tx) => {
      await lock(tx, subjectSlug);
      const existing = await tx.subject.findUnique({
        where: { slug: subjectSlug },
        select: {
          id: true,
          groupSubjects: { select: { groupId: true }, take: 1 },
        },
      });
      if (existing)
        return {
          subjectId: existing.id,
          groupId: existing.groupSubjects[0].groupId,
        };

      const notice = await currentGroupNotice(tx);
      if (!notice)
        throw new Error("Сначала загрузите данные обычного preview.");
      const department = await tx.department.findFirstOrThrow({
        where: { slug: "unassigned", faculty: { slug: "stomatology" } },
      });
      const subjectId = randomUUID();
      await tx.subject.create({
        data: {
          id: subjectId,
          slug: subjectSlug,
          title: "Нагрузочный предмет (демо)",
          shortDescription: "Синтетический материал для замера журнала.",
          courses: [1],
          status: "PUBLISHED",
          departmentId: department.id,
        },
      });
      const { id: groupId } = await tx.studyGroup.create({
        data: {
          facultyId: department.facultyId,
          name: "Нагрузочная группа 40 × 80 (демо)",
          course: 1,
          academicYear: academicYear(now),
        },
      });
      await tx.groupSubject.create({
        data: {
          groupId,
          subjectId,
          teachers: { create: { teacherId: teacher.id } },
        },
      });
      if (teacher.role !== "ADMIN") {
        await tx.roleAssignment.create({
          data: {
            userId: teacher.id,
            role: "REVIEWER",
            subjectId,
            scopeKey: `subject:${subjectId}`,
          },
        });
      }
      const sections = Array.from({ length: 4 }, (_, order) => ({
        id: randomUUID(),
        subjectId,
        title: `Раздел ${order + 1}`,
        order,
      }));
      await tx.section.createMany({ data: sections });
      const contentMd =
        "## Демонстрация\n\nПервый ответ [[синий|зелёный]].\n\nВторой ответ [[два|три]].";
      const exercise = parseTopic(contentMd).gaps;
      const topics = Array.from({ length: 80 }, (_, order) => ({
        ...withTopicDraft({
          subjectId,
          sectionId: sections[Math.floor(order / 20)].id,
          slug: `benchmark-${order + 1}`,
          title: `Демо-тема ${order + 1}`,
          order,
          contentMd,
          status: "PUBLISHED",
          version: 1,
          publishedAt: now,
          isFree: true,
          needsExpertReview: false,
        }),
        id: randomUUID(),
      }));
      await tx.topic.createMany({ data: topics });
      const gaps = topics.map((t) =>
        exercise.map((g) => ({
          id: randomUUID(),
          topicId: t.id,
          gapKey: g.gapKey,
          blockKey: g.blockKey,
          order: g.order,
          answer: g.answer,
          distractors: g.distractors,
          sentence: g.sentence,
        })),
      );
      await tx.gap.createMany({ data: gaps.flat() });
      const questions = topics.map((t) => ({
        id: randomUUID(),
        topicId: t.id,
        stem: "Какой пример разобран в теме?",
        explanation: "Эталон синтетического вопроса для нагрузочного замера.",
        options: [
          { id: "a", text: "Первый пример" },
          { id: "b", text: "Второй пример" },
        ],
        correctOptionIds: ["a"],
        publishedAt: now,
      }));
      await tx.question.createMany({ data: questions });
      await tx.topicRevision.createMany({
        data: topics.map((topic, i) => ({
          topicId: topic.id,
          version: 1,
          title: topic.title,
          contentMd,
          gapExercises: {},
          questions: [
            {
              id: questions[i].id,
              stem: questions[i].stem,
              options: questions[i].options,
              correctOptionIds: questions[i].correctOptionIds,
            },
          ],
          publishedAt: now,
        })),
      });
      const profiles = studentProfiles();
      const people = Array.from({ length: 40 }, (_, index) => {
        const profile = profiles[index % profiles.length];
        const number = String(index + 1).padStart(2, "0");
        const [, firstName, lastName] = profile.name.split(" ");
        return {
          profile,
          user: {
            id: `preview-journal-student-${number}`,
            email: `preview-journal-${number}@example.test`,
            name: profile.name,
            firstName,
            lastName,
            studentNumber: `ДЕМО-${number}`,
            course: 1,
            createdAt: new Date(+now - 45 * dayMs),
            emailVerifiedAt: now,
            consentPdAt: now,
            consentPdVersion: legal.consent.version,
            offerVersion: legal.offer.version,
          },
        };
      });
      await tx.user.createMany({ data: people.map((p) => p.user) });
      await tx.groupMember.createMany({
        data: people.map(({ user }) => ({
          groupId,
          userId: user.id,
          status: "ACTIVE",
          noticeVersion: notice.version,
          noticeAcceptedAt: now,
          decidedAt: now,
        })),
      });
      const activity = people.flatMap(({ profile, user }) =>
        studentPlan(profile, topics.length).map((plan, i) => {
          const topicId = topics[i].id;
          const at = new Date(
            +now - plan.daysAgo * dayMs - (topics.length - i) * 3600000,
          );
          const finishedAt = new Date(+at + 120000);
          const isCorrect = i % 5 < plan.score * 5;
          return {
            userId: user.id,
            topicId,
            at,
            finishedAt,
            isCorrect,
            gaps: gaps[i],
            questionId: questions[i].id,
            runId: randomUUID(),
          };
        }),
      );
      await tx.topicProgress.createMany({
        data: activity.map((a) => ({
          userId: a.userId,
          topicId: a.topicId,
          lastOpenedAt: a.finishedAt,
          gapsAnswered: 2,
          gapsCorrect: a.isCorrect ? 2 : 1,
          testBestScore: Number(a.isCorrect),
          completedAt: a.isCorrect ? a.finishedAt : null,
        })),
      });
      const firstAnswers = activity.flatMap((a) =>
        a.gaps.map((g, i) => {
          const isCorrect = a.isCorrect || i === 1;
          const chosen = isCorrect ? g.answer : g.distractors[0];
          return {
            userId: a.userId,
            gapId: g.id,
            chosen,
            isCorrect,
            createdAt: a.at,
          };
        }),
      );
      await tx.gapAnswer.createMany({
        data: firstAnswers.map((a) => ({ ...a, chosenValues: [a.chosen] })),
      });
      await tx.gapAttempt.createMany({
        data: firstAnswers.map(({ chosen, ...a }) => ({
          ...a,
          chosenValues: [chosen],
          chosenText: null,
          practice: false,
          topicVersion: 1,
        })),
      });
      await tx.testRun.createMany({
        data: activity.map((a) => ({
          id: a.runId,
          userId: a.userId,
          topicId: a.topicId,
          subjectId,
          mode: "TOPIC",
          topicVersion: 1,
          total: 1,
          correct: Number(a.isCorrect),
          score: Number(a.isCorrect),
          startedAt: a.at,
          finishedAt: a.finishedAt,
        })),
      });
      await tx.questionAttempt.createMany({
        data: activity.map((a) => ({
          testRunId: a.runId,
          questionId: a.questionId,
          chosenOptionIds: [a.isCorrect ? "a" : "b"],
          isCorrect: a.isCorrect,
          createdAt: a.finishedAt,
        })),
      });
      await tx.card.createMany({
        data: activity
          .filter((a) => !a.isCorrect)
          .map((a) => ({
            userId: a.userId,
            topicId: a.topicId,
            subjectId,
            source: "GAP",
            gapId: a.gaps[0].id,
            dueAt: new Date(+a.at + dayMs),
          })),
      });
      return { subjectId, groupId };
    },
    { timeout: 60000 },
  );
  return { ...sample, teacherId: teacher.id };
}

async function measure(path: string, teacherId: string) {
  const app = process.env.APP_URL;
  if (!app) throw new Error("Укажите APP_URL запущенного локального preview.");
  const db = getDb();
  const token = newToken();
  const session = await db.session.create({
    data: {
      userId: teacherId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  try {
    for (const [label, route] of [
      ["Журнал", path],
      ["Карточка", `${path}/students/preview-journal-student-01`],
    ]) {
      const times: number[] = [];
      for (let i = 0; i < 28; i++) {
        const start = performance.now();
        const response = await fetch(new URL(route, app), {
          headers: { cookie: `sid=${token}` },
          redirect: "manual",
        });
        await response.arrayBuffer();
        if (!response.ok)
          throw new Error(
            `${label}: HTTP ${response.status}. Проверьте согласия преподавателя и APP_URL.`,
          );
        if (i >= 3) times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1];
      console.log(
        `${label}: p95 ${Math.round(p95)} мс, максимум ${Math.round(times.at(-1)!)} мс, 25 запросов`,
      );
    }
  } finally {
    await db.session.delete({ where: { id: session.id } });
  }
}

async function main() {
  assertStudentPreview(process.env.DATABASE_URL, process.env.NODE_ENV);
  try {
    const { groupId, subjectId, teacherId } = await seed();
    const path = `/teacher/groups/${groupId}/subjects/${subjectId}`;
    console.log(path);
    if (process.argv.includes("--measure")) await measure(path, teacherId);
  } finally {
    await getDb().$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Не удалось подготовить нагрузочное демо.",
  );
  process.exitCode = 1;
});
