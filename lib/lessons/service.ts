import { track } from "../analytics/events";
import {
  creationSettings,
  cardFromGap,
  cardFromWrongQuestion,
  lessonReview,
} from "../srs/cards";
import { gradeAnswer, type Definition, type Submission } from "../exercises";
import { getDb } from "../db";
import type {
  Prisma,
  Gap,
  GapAnswer,
  Question,
  QuestionAttempt,
} from "../generated/prisma/client";
import { hasAccess, consumeLimit } from "../access";
import { getSetting } from "../settings";
import { lock } from "../auth/session";
import { ContentError } from "../content/errors";
import { actorKey, lockLearningActor } from "./actor";
import {
  completedLesson,
  optionsFromJSON,
  publicBlocks,
  shuffledOptions,
} from "./public";
import type {
  Actor,
  LessonData,
  LessonGap,
  LessonTest,
  GapFeedback,
  QuestionFeedback,
} from "./types";
type Db = Prisma.TransactionClient;
const order = [{ order: "asc" as const }, { id: "asc" as const }];
export async function publishedTopic(id: string, db: Db = getDb()) {
  const topic = await db.topic.findFirst({
    where: { id, status: "PUBLISHED", subject: { status: "PUBLISHED" } },
  });
  if (!topic) throw new ContentError("Тема не найдена.", 404);
  return topic;
}
async function accessibleTopic(id: string, actor: Actor, db: Db) {
  const topic = await publishedTopic(id, db);
  if (!(await hasAccess(actor.userId ?? null, topic, db)))
    throw new ContentError("Для этой темы нужен доступ к предмету.", 403);
  return topic;
}
function gapFeedback(
  gap: Gap,
  answer: Pick<
    GapAnswer,
    "chosen" | "isCorrect" | "chosenValues" | "correctValues" | "explanation"
  >,
): GapFeedback {
  const chosenValues = answer.chosenValues.length
    ? answer.chosenValues
    : [answer.chosen];
  const correctValues = answer.correctValues.length
    ? answer.correctValues
    : [gap.answer];
  return {
    chosen: answer.chosen,
    correct: answer.isCorrect,
    answer: correctValues.join("; "),
    chosenValues,
    correctValues,
    explanation: answer.explanation,
  };
}
function questionFeedback(
  q: Question,
  attempt: QuestionAttempt,
): QuestionFeedback {
  return {
    chosenId: attempt.chosenOptionIds[0] ?? "",
    correct: attempt.isCorrect,
    correctId: q.correctOptionIds[0] ?? "",
    chosenIds: attempt.chosenOptionIds,
    correctIds: q.correctOptionIds,
    chosenText: attempt.chosenText,
    answerText: q.answerType === "SHORT_TEXT" ? q.acceptedAnswers[0] : null,
    explanation: q.explanation,
    sourceBlockKey: q.sourceBlockKey,
  };
}
function gapOptions(g: Gap, actor: Actor) {
  return g.answerType === "SHORT_TEXT"
    ? []
    : shuffledOptions([g.answer, ...g.distractors], actorKey(actor), g.id);
}
function grade(definition: Definition, input: Submission) {
  try {
    return gradeAnswer(definition, input);
  } catch (error) {
    throw new ContentError(
      error instanceof Error ? error.message : "Проверьте ответ.",
    );
  }
}
export async function progressFor(
  topicId: string,
  actor: Actor,
  threshold: number,
  db: Db = getDb(),
) {
  const [total, answered, correct, best] = await Promise.all([
    db.gap.count({ where: { topicId, archivedAt: null } }),
    db.gapAnswer.count({
      where: { ...actor, gap: { topicId, archivedAt: null } },
    }),
    db.gapAnswer.count({
      where: { ...actor, isCorrect: true, gap: { topicId, archivedAt: null } },
    }),
    db.testRun.aggregate({
      where: { ...actor, topicId, mode: "TOPIC", finishedAt: { not: null } },
      _max: { score: true },
    }),
  ]);
  const bestScore = best._max.score;
  const completed = completedLesson(answered, total, bestScore, threshold);
  if (actor.userId) {
    const existing = await db.topicProgress.findUnique({
      where: { userId_topicId: { userId: actor.userId, topicId } },
    });
    const data = {
      gapsAnswered: answered,
      gapsCorrect: correct,
      testBestScore: bestScore,
      completedAt: completed ? (existing?.completedAt ?? new Date()) : null,
      lastOpenedAt: new Date(),
    };
    await db.topicProgress.upsert({
      where: { userId_topicId: { userId: actor.userId, topicId } },
      create: { userId: actor.userId, topicId, ...data },
      update: data,
    });
  }
  return { answered, correct, total, bestScore, completed };
}
async function testFor(
  topicId: string,
  version: number,
  actor: Actor,
  db: Db,
): Promise<LessonTest> {
  const questions = await db.question.findMany({
    where: { topicId, archivedAt: null },
    orderBy: order,
  });
  const run = await db.testRun.findFirst({
    where: { ...actor, topicId, mode: "TOPIC", topicVersion: version },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    include: { questionAttempt_testRunId: true },
  });
  return {
    runId: run?.id ?? null,
    score: run?.score ?? null,
    finished: !!run?.finishedAt,
    questions: questions.map((q) => {
      const attempt = run?.questionAttempt_testRunId.find(
        (a) => a.questionId === q.id,
      );
      // Explicit allowlist; explanation and correctness only after this question was answered.
      return {
        id: q.id,
        answerType: q.answerType,
        stem: q.stem,
        options: optionsFromJSON(q.options),
        feedback: attempt ? questionFeedback(q, attempt) : null,
      };
    }),
  };
}
export async function loadLesson(
  topicId: string,
  actor: Actor,
): Promise<LessonData> {
  await consumeLimit(actorKey(actor));
  const threshold = await getSetting("lesson.passThreshold");
  return getDb().$transaction(async (tx) => {
    await lockLearningActor(tx, actor);
    // Readers may share a topic; publication/deletion still require the exclusive lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`content:topic:${topicId}`},0))`;
    const topic = await publishedTopic(topicId, tx);
    const allowed = await hasAccess(actor.userId ?? null, topic, tx);
    const base = {
      topicId,
      version: topic.version,
      locked: !allowed,
      passThreshold: threshold,
    };
    await track(
      allowed ? "topic_opened" : "paywall_shown",
      allowed ? { topicId, isFree: topic.isFree } : { topicId },
      actor,
      tx,
    );
    if (!allowed)
      return {
        ...base,
        blocks: publicBlocks(
          topic.contentMd,
          new Map(),
          await getSetting("lesson.paywallPreviewBlocks"),
        ),
        gaps: [],
        test: null,
        progress: null,
        review: null,
      };
    const gaps = await tx.gap.findMany({
      where: { topicId, archivedAt: null },
      orderBy: order,
    });
    const answers = await tx.gapAnswer.findMany({
      where: { ...actor, gap: { topicId, archivedAt: null } },
    });
    const publicGaps: LessonGap[] = gaps.map((g) => {
      const answer = answers.find((a) => a.gapId === g.id);
      return {
        id: g.id,
        answerType: g.answerType,
        blockKey: g.blockKey,
        stem: g.sentence,
        options: gapOptions(g, actor),
        feedback: answer ? gapFeedback(g, answer) : null,
      };
    });
    return {
      ...base,
      blocks: publicBlocks(
        topic.contentMd,
        new Map(gaps.map((g) => [g.gapKey, g.id])),
      ),
      gaps: publicGaps,
      test: await testFor(topicId, topic.version, actor, tx),
      progress: await progressFor(topicId, actor, threshold, tx),
      review: await lessonReview(tx, actor, topicId),
    };
  });
}
export async function answerGap(
  gapId: string,
  submission: string | Submission,
  version: number,
  actor: Actor,
  practice = false,
) {
  await consumeLimit(actorKey(actor));
  const [threshold, cardSettings] = await Promise.all([
    getSetting("lesson.passThreshold"),
    creationSettings(),
  ]);
  return getDb().$transaction(async (tx) => {
    await lockLearningActor(tx, actor);
    const initial = await tx.gap.findUnique({
      where: { id: gapId },
      select: { topicId: true },
    });
    if (!initial) throw new ContentError("Пропуск не найден.", 404);
    await lock(tx, `content:topic:${initial.topicId}`);
    const topic = await accessibleTopic(initial.topicId, actor, tx);
    if (topic.version !== version)
      throw new ContentError("Тема обновлена. Перезагрузите страницу.", 409);
    const gap = await tx.gap.findUnique({ where: { id: gapId } });
    if (!gap || gap.archivedAt)
      throw new ContentError("Пропуск больше не доступен.", 409);
    const options = gapOptions(gap, actor);
    const correct = gap.correctAnswers.length
      ? gap.correctAnswers
      : [gap.answer];
    const checked = grade(
      {
        answerType: gap.answerType,
        options,
        correctOptionIds: options
          .filter((o) => correct.includes(o.text))
          .map((o) => o.id),
        acceptedAnswers:
          gap.answerType === "SHORT_TEXT"
            ? gap.acceptedAnswers.length
              ? gap.acceptedAnswers
              : [gap.answer]
            : [],
        explanation: gap.explanation,
      },
      typeof submission === "string" ? { optionIds: [submission] } : submission,
    );
    const chosen = checked.chosenValues.join("; ");
    const snapshot = {
      chosen,
      isCorrect: checked.isCorrect,
      chosenValues: checked.chosenValues,
      correctValues: checked.correctValues,
      explanation: gap.explanation,
    };
    const existing = await tx.gapAnswer.findFirst({
      where: { ...actor, gapId },
    });
    const answer =
      existing ??
      (await tx.gapAnswer.create({
        data: { ...actor, gapId, ...snapshot },
      }));
    if (!existing)
      await track(
        "gap_answered",
        { gapId, isCorrect: answer.isCorrect },
        actor,
        tx,
        `gap:${answer.id}`,
      );
    if (!existing)
      await cardFromGap(
        tx,
        actor,
        gap,
        topic.subjectId,
        answer.isCorrect,
        cardSettings,
      );
    return {
      feedback: gapFeedback(gap, practice && existing ? snapshot : answer),
      progress: await progressFor(topic.id, actor, threshold, tx),
      review: await lessonReview(tx, actor, topic.id),
    };
  });
}
export async function startTest(
  topicId: string,
  version: number,
  actor: Actor,
) {
  await consumeLimit(actorKey(actor));
  return getDb().$transaction(async (tx) => {
    await lockLearningActor(tx, actor);
    await lock(tx, `content:topic:${topicId}`);
    const topic = await accessibleTopic(topicId, actor, tx);
    if (topic.version !== version)
      throw new ContentError("Тема обновлена. Перезагрузите страницу.", 409);
    const open = await tx.testRun.findFirst({
      where: {
        ...actor,
        topicId,
        topicVersion: version,
        mode: "TOPIC",
        finishedAt: null,
      },
    });
    if (!open) {
      const total = await tx.question.count({
        where: { topicId, archivedAt: null },
      });
      if (!total) throw new ContentError("Тест пока недоступен.", 409);
      await tx.testRun.create({
        data: {
          ...actor,
          topicId,
          subjectId: topic.subjectId,
          mode: "TOPIC",
          topicVersion: version,
          total,
        },
      });
    }
    return testFor(topicId, version, actor, tx);
  });
}
export async function answerQuestion(
  topicId: string,
  runId: string,
  questionId: string,
  submission: string | Submission,
  actor: Actor,
) {
  await consumeLimit(actorKey(actor));
  const [threshold, cardSettings] = await Promise.all([
    getSetting("lesson.passThreshold"),
    creationSettings(),
  ]);
  return getDb().$transaction(async (tx) => {
    await lockLearningActor(tx, actor);
    await lock(tx, `content:topic:${topicId}`);
    const topic = await accessibleTopic(topicId, actor, tx);
    const run = await tx.testRun.findFirst({
      where: { id: runId, topicId, ...actor, mode: "TOPIC" },
    });
    if (!run) throw new ContentError("Попытка теста не найдена.", 404);
    if (run.topicVersion !== topic.version)
      throw new ContentError("Тема обновлена. Начните тест заново.", 409);
    const q = await tx.question.findFirst({
      where: { id: questionId, topicId, archivedAt: null },
    });
    if (!q) throw new ContentError("Вопрос или вариант ответа не найден.", 422);
    const input =
      typeof submission === "string" ? { optionIds: [submission] } : submission;
    const checked = grade(
      {
        answerType: q.answerType,
        options: optionsFromJSON(q.options),
        correctOptionIds: q.correctOptionIds,
        acceptedAnswers: q.acceptedAnswers,
        explanation: q.explanation,
      },
      input,
    );
    let attempt = await tx.questionAttempt.findUnique({
      where: { testRunId_questionId: { testRunId: runId, questionId } },
    });
    if (!attempt) {
      if (run.finishedAt)
        throw new ContentError("Эта попытка уже завершена.", 409);
      attempt = await tx.questionAttempt.create({
        data: {
          testRunId: runId,
          questionId,
          chosenOptionIds: input.optionIds ?? [],
          chosenText:
            q.answerType === "SHORT_TEXT" ? checked.chosenValues[0] : null,
          isCorrect: checked.isCorrect,
        },
      });
      if (!attempt.isCorrect)
        await cardFromWrongQuestion(
          tx,
          actor,
          q,
          topic.subjectId,
          cardSettings,
        );
      const attempts = await tx.questionAttempt.findMany({
        where: { testRunId: runId },
        select: { isCorrect: true },
      });
      const correct = attempts.filter((a) => a.isCorrect).length;
      if (attempts.length === run.total)
        await track(
          "test_completed",
          { topicId, score: correct / run.total },
          actor,
          tx,
          `test:${runId}`,
        );
      await tx.testRun.update({
        where: { id: runId },
        data: {
          correct,
          ...(attempts.length === run.total
            ? { score: correct / run.total, finishedAt: new Date() }
            : {}),
        },
      });
    }
    return {
      feedback: questionFeedback(q, attempt),
      test: await testFor(topicId, topic.version, actor, tx),
      progress: await progressFor(topicId, actor, threshold, tx),
      review: await lessonReview(tx, actor, topicId),
    };
  });
}
