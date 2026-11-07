import { getSetting } from "../settings";
import { randomInt } from "node:crypto";
import { getDb } from "../db";
import { lock } from "../auth/session";
import { ContentError } from "../content/errors";
import { lockLearningActor } from "../lessons/actor";
import { optionsFromJSON } from "../lessons/public";
import { loadLesson } from "../lessons/service";
import { gradeAnswer } from "../exercises";
import { hasAccess, consumeLimit } from "../access";
import { track } from "../analytics/events";
import { reviewSettings } from "../srs/settings";
import { schedule, intervalLabel } from "../srs/schedule";
import { readFlow, diagnosticSummary, type DemoAction } from "./flow";
import type { Prisma } from "../generated/prisma/client";
type Db = Prisma.TransactionClient;
const published = {
  status: "PUBLISHED" as const,
  needsExpertReview: false,
  reviewedAt: { not: null },
};
async function subjects(db: Db) {
  const rows = await db.subject.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ order: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      topic_subjectId: {
        where: published,
        orderBy: [{ order: "asc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          isFree: true,
          version: true,
          question_topicId: {
            where: { archivedAt: null, isDiagnostic: true },
            select: { id: true },
          },
        },
      },
    },
  });
  return rows.filter(
    (s) =>
      s.topic_subjectId.some((t) => t.isFree) &&
      s.topic_subjectId.filter((t) => t.question_topicId.length).length >= 3,
  );
}
function conflict() {
  return new ContentError("Этот шаг недоступен. Обновите страницу демо.", 409);
}
async function getSession(db: Db, id: string) {
  await lock(db, `demo-flow:${id}`);
  await lockLearningActor(db, { demoSessionId: id });
  return db.demoSession.findUniqueOrThrow({ where: { id } });
}
export async function demoAction(id: string, input: DemoAction) {
  await consumeLimit(`demo:${id}`);
  const settings = await reviewSettings();
  await getDb().$transaction(async (tx) => {
    const row = await getSession(tx, id),
      flow = readFlow(row.flow);
    let step = row.step;
    const completed = new Set(row.stepsCompleted);
    const event = async (
      name: Parameters<typeof track>[0],
      props: unknown,
      key: string,
    ) => track(name, props, { demoSessionId: id }, tx, `demo:${id}:${key}`);
    switch (input.action) {
      case "goal": {
        if (step !== 1) throw conflict();
        if (input.goal === "other" && !input.text)
          throw new ContentError("Напишите цель до 200 символов.", 422);
        flow.skip = input.goal === "skip";
        await tx.demoSession.update({
          where: { id },
          data: {
            goal: input.goal,
            goalText: input.goal === "other" ? input.text : null,
          },
        });
        await event("demo_goal_selected", { goal: input.goal }, "goal");
        completed.add(1);
        step = 2;
        break;
      }
      case "subject": {
        if (step !== 2) throw conflict();
        const subject = (await subjects(tx)).find(
          (s) => s.id === input.subjectId,
        );
        if (!subject)
          throw new ContentError(
            "Предмет пока не готов для демо. Выберите другой.",
            409,
          );
        flow.topicId = subject.topic_subjectId.find((t) => t.isFree)!.id;
        if (!flow.skip) {
          const pool = subject.topic_subjectId.filter(
            (t) => t.question_topicId.length,
          );
          // Randomize on the server once, then persist the immutable manifest.
          for (let i = pool.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          flow.questions = pool.slice(0, 3).map((t) => ({
            id: t.question_topicId[randomInt(t.question_topicId.length)].id,
            topicId: t.id,
            version: t.version,
          }));
          const run = await tx.testRun.create({
            data: {
              mode: "DIAGNOSTIC",
              subjectId: subject.id,
              demoSessionId: id,
              total: 3,
            },
          });
          flow.runId = run.id;
        }
        await tx.demoSession.update({
          where: { id },
          data: { subjectId: subject.id },
        });
        await event(
          "demo_subject_selected",
          { subjectId: subject.id },
          "subject",
        );
        completed.add(2);
        step = flow.skip ? 5 : 3;
        if (flow.skip)
          await event(
            "demo_lesson_opened",
            { topicId: flow.topicId },
            "lesson",
          );
        break;
      }
      case "answer": {
        if (step !== 3 || !flow.runId) throw conflict();
        const attempts = await tx.questionAttempt.findMany({
          where: { testRunId: flow.runId },
        });
        const duplicate = attempts.find(
          (a) => a.questionId === input.questionId,
        );
        if (duplicate) break;
        const pinned = flow.questions[attempts.length];
        if (!pinned || pinned.id !== input.questionId) throw conflict();
        await lock(tx, `content:topic:${pinned.topicId}`);
        const q = await tx.question.findFirst({
          where: {
            id: pinned.id,
            archivedAt: null,
            isDiagnostic: true,
            topic: {
              ...published,
              version: pinned.version,
              subject: { status: "PUBLISHED" },
            },
          },
          include: { topic: true },
        });
        if (!q)
          throw new ContentError(
            "Диагностика обновлена. Продолжите с бесплатного урока через каталог.",
            409,
          );
        // Diagnostic questions may belong to paid topics. Only the stem/options are public.
        let graded;
        try {
          graded = gradeAnswer(
            { ...q, options: optionsFromJSON(q.options) },
            input.submission,
          );
        } catch {
          throw new ContentError("Выберите допустимый ответ на вопрос.", 422);
        }
        await tx.questionAttempt.create({
          data: {
            testRunId: flow.runId,
            questionId: q.id,
            chosenOptionIds: input.submission.optionIds ?? [],
            chosenText: input.submission.text,
            isCorrect: graded.isCorrect,
          },
        });
        const all = [
          ...attempts,
          { questionId: q.id, isCorrect: graded.isCorrect },
        ];
        const correct = all.filter((a) => a.isCorrect).length;
        await tx.testRun.update({
          where: { id: flow.runId },
          data: {
            correct,
            ...(all.length === 3
              ? { score: correct / 3, finishedAt: new Date() }
              : {}),
          },
        });
        if (all.length === 3) {
          const summary = diagnosticSummary(
            flow.questions.map((q) => ({
              topicId: q.topicId,
              isCorrect: all.find((a) => a.questionId === q.id)!.isCorrect,
            })),
          );
          await tx.demoSession.update({
            where: { id },
            data: { diagnostic: summary },
          });
          await event("diagnostic_completed", { correct }, "diagnostic");
          completed.add(3);
          step = 4;
        }
        break;
      }
      case "lesson": {
        if (step !== 4 || !flow.topicId) throw conflict();
        completed.add(4);
        step = 5;
        await event("demo_lesson_opened", { topicId: flow.topicId }, "lesson");
        break;
      }
      case "review": {
        if (step !== 5 || !flow.topicId) throw conflict();
        const answers = await tx.gapAnswer.findMany({
          where: {
            demoSessionId: id,
            gap: { topicId: flow.topicId, archivedAt: null },
          },
          orderBy: [{ isCorrect: "asc" }, { createdAt: "asc" }],
          select: { gapId: true },
        });
        const cards = await tx.card.findMany({
          where: {
            demoSessionId: id,
            source: "GAP",
            suspended: false,
            gapId: { in: answers.map((a) => a.gapId) },
          },
        });
        flow.cardIds = answers
          .map((a) => cards.find((c) => c.gapId === a.gapId)?.id)
          .filter((v): v is string => !!v)
          .slice(0, 3);
        completed.add(5);
        step = 6;
        break;
      }
      case "reveal":
      case "rate": {
        if (step !== 6 || !flow.cardIds.includes(input.cardId))
          throw conflict();
        if (flow.rated.includes(input.cardId)) break;
        if (!flow.topicId) throw conflict();
        await lock(tx, `content:topic:${flow.topicId}`);
        const card = await tx.card.findFirst({
          where: {
            id: input.cardId,
            demoSessionId: id,
            topicId: flow.topicId,
            source: "GAP",
            suspended: false,
          },
          include: { gap: true, topic: { include: { subject: true } } },
        });
        if (
          !card ||
          !card.gap ||
          card.gap.archivedAt ||
          card.topic.status !== "PUBLISHED" ||
          card.topic.subject.status !== "PUBLISHED" ||
          !(await hasAccess(null, card.topic, tx))
        )
          throw conflict();
        if (input.action === "reveal") {
          if (!flow.revealed.includes(card.id)) flow.revealed.push(card.id);
          await tx.card.update({
            where: { id: card.id },
            data: {
              firstShownAt: card.firstShownAt ?? new Date(),
              revealedAt: new Date(),
              revealedTopicVersion: card.topic.version,
            },
          });
        } else {
          if (
            !flow.revealed.includes(card.id) ||
            card.revealedTopicVersion !== card.topic.version
          )
            throw conflict();
          const result = schedule(card, input.rating, new Date(), settings);
          await tx.reviewLog.create({
            data: {
              cardId: card.id,
              cardRevision: card.revision,
              rating: input.rating,
              prevIntervalDays: card.intervalDays,
              newIntervalDays: result.intervalDays,
            },
          });
          await tx.card.update({
            where: { id: card.id },
            data: {
              ...result,
              revision: { increment: 1 },
              revealedAt: null,
              revealedTopicVersion: null,
            },
          });
          flow.rated.push(card.id);
        }
        break;
      }
      case "finish": {
        if (step === 7) break;
        if (step !== 6 || flow.cardIds.some((c) => !flow.rated.includes(c)))
          throw conflict();
        completed.add(6);
        step = 7;
        await tx.demoSession.update({
          where: { id },
          data: { completedAt: new Date() },
        });
        await event("demo_completed", {}, "completed");
        await event(
          "review_session_completed",
          { reviewed: flow.rated.length },
          "review",
        );
        break;
      }
    }
    await tx.demoSession.update({
      where: { id },
      data: { step, stepsCompleted: [...completed], flow },
    });
  });
  return demoView(id);
}
export async function demoView(
  id: string,
  source: "landing" | "direct" = "direct",
) {
  const settings = await reviewSettings();
  const view = await getDb().$transaction(async (tx) => {
    const row = await getSession(tx, id),
      flow = readFlow(row.flow);
    await track(
      "demo_started",
      { source },
      { demoSessionId: id },
      tx,
      `demo:${id}:start`,
    );
    const available =
      row.step === 2
        ? (await subjects(tx)).map((s) => ({ id: s.id, title: s.title }))
        : [];
    const attempts = flow.runId
      ? await tx.questionAttempt.findMany({
          where: { testRunId: flow.runId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { questionId: true, isCorrect: true },
        })
      : [];
    let question = null;
    if (row.step === 3) {
      const pinned = flow.questions[attempts.length];
      if (pinned) {
        const q = await tx.question.findFirst({
          where: {
            id: pinned.id,
            archivedAt: null,
            isDiagnostic: true,
            topic: {
              ...published,
              version: pinned.version,
              subject: { status: "PUBLISHED" },
            },
          },
        });
        if (!q)
          throw new ContentError(
            "Вопросы обновлены. Откройте бесплатный урок через каталог.",
            409,
          );
        question = {
          id: q.id,
          stem: q.stem,
          answerType: q.answerType,
          options: optionsFromJSON(q.options).sort((a, b) =>
            a.id.localeCompare(b.id),
          ),
        };
      }
    }
    const titles = await tx.topic.findMany({
      where: {
        id: { in: flow.questions.map((q) => q.topicId) },
        status: "PUBLISHED",
        subject: { status: "PUBLISHED" },
      },
      select: { id: true, title: true },
    });
    const strong = flow.questions
      .filter((q) => attempts.some((a) => a.questionId === q.id && a.isCorrect))
      .flatMap((q) =>
        titles.filter((t) => t.id === q.topicId).map((t) => t.title),
      );
    const weak = flow.questions
      .filter((q) =>
        attempts.some((a) => a.questionId === q.id && !a.isCorrect),
      )
      .flatMap((q) =>
        titles.filter((t) => t.id === q.topicId).map((t) => t.title),
      );
    const cardId = flow.cardIds.find((c) => !flow.rated.includes(c));
    let card = null;
    if (row.step === 6 && cardId) {
      const c = await tx.card.findFirst({
        where: {
          id: cardId,
          demoSessionId: id,
          suspended: false,
          gap: { archivedAt: null },
          topic: {
            ...published,
            isFree: true,
            subject: { status: "PUBLISHED" },
          },
        },
        include: { gap: true },
      });
      if (!c?.gap)
        throw new ContentError(
          "Карточка обновлена. Откройте урок через каталог.",
          409,
        );
      card = {
        id: c.id,
        prompt: c.gap.sentence,
        answer: flow.revealed.includes(c.id)
          ? (c.gap.correctAnswers.length
              ? c.gap.correctAnswers
              : [c.gap.answer]
            ).join("; ")
          : null,
        intervals: (["HARD", "GOOD", "EASY"] as const).map((rating) => ({
          rating,
          label: intervalLabel(
            rating,
            schedule(c, rating, new Date(), settings),
            settings,
          ),
        })),
      };
    }
    return {
      step: row.step,
      subjects: available,
      question,
      answered: attempts.length,
      lastCorrect: attempts.at(-1)?.isCorrect ?? null,
      correct: attempts.filter((a) => a.isCorrect).length,
      strong,
      weak,
      card,
      cardCount: flow.cardIds.length,
      reviewed: flow.rated.length,
      topicId: row.step === 5 ? flow.topicId : undefined,
    };
  });
  const lesson = view.topicId
    ? await loadLesson(view.topicId, { demoSessionId: id })
    : null;
  return { ...view, lesson, guestDays: await getSetting("lesson.guestDays") };
}
export type DemoView = Awaited<ReturnType<typeof demoView>>;
