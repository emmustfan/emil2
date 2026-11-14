import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import type { Actor } from "../lessons/types";
import { hasAccess } from "../access";
import { ContentError } from "../content/errors";
import { lock } from "../auth/session";
import { optionsFromJSON } from "../lessons/public";
import { explainQuestion } from "./prompts";
import type { TutorInput, Citation } from "./types";
export async function resolveScope(
  input: TutorInput,
  actor: Actor,
  tx: Prisma.TransactionClient,
) {
  let topicId = input.kind === "question" ? input.topicId : undefined,
    question = input.kind === "question" ? input.text : "";
  if (input.kind === "explain") {
    const source =
      input.source === "GAP"
        ? await tx.gap.findUnique({
            where: { id: input.sourceId },
            select: { topicId: true },
          })
        : await tx.question.findUnique({
            where: { id: input.sourceId },
            select: { topicId: true },
          });
    if (!source) throw new ContentError("Задание не найдено.", 404);
    topicId = source.topicId;
  }
  if (!actor.userId && !topicId)
    throw new ContentError(
      "Гость может задать вопрос только по открытой бесплатной теме.",
      403,
    );
  if (topicId) await lock(tx, `content:topic:${topicId}`);
  const topic = topicId
    ? await tx.topic.findFirst({
        where: {
          id: topicId,
          status: "PUBLISHED",
          subject: { status: "PUBLISHED" },
        },
      })
    : null;
  if (topicId && !topic) throw new ContentError("Тема не найдена.", 404);
  if (topic && !(await hasAccess(actor.userId ?? null, topic, tx)))
    throw new ContentError("Для этой темы нужен доступ к предмету.", 403);
  const subjectId =
    topic?.subjectId ??
    (input.kind === "question" ? input.subjectId : undefined);
  if (
    !subjectId ||
    !(await tx.subject.count({ where: { id: subjectId, status: "PUBLISHED" } }))
  )
    throw new ContentError("Предмет не найден.", 404);
  if (
    input.kind === "question" &&
    input.subjectId &&
    input.subjectId !== subjectId
  )
    throw new ContentError("Предмет и тема не совпадают.");
  if (input.kind === "explain") {
    if (topic!.version !== input.topicVersion)
      throw new ContentError("Тема обновлена. Перезагрузите урок.", 409);
    if (input.source === "GAP") {
      const g = await tx.gap.findFirst({
          where: { id: input.sourceId, archivedAt: null },
        }),
        a = await tx.gapAnswer.findFirst({
          where: { gapId: input.sourceId, ...actor },
        });
      if (!g || !a || a.isCorrect)
        throw new ContentError(
          "Объяснение доступно после неверного ответа на это задание.",
          409,
        );
      const answers =
        g.answerType === "SHORT_TEXT"
          ? [g.acceptedAnswers[0] ?? g.answer]
          : g.correctAnswers.length
            ? g.correctAnswers
            : [g.answer];
      if (
        a.correctValues.length &&
        JSON.stringify(a.correctValues) !== JSON.stringify(answers)
      )
        throw new ContentError(
          "Ответ задания обновился. Перезагрузите урок.",
          409,
        );
      question = explainQuestion({
        prompt: g.sentence,
        chosen: a.chosenValues.length ? a.chosenValues : [a.chosen],
        answers,
        explanation: g.explanation,
      });
    } else {
      if (!input.runId) throw new ContentError("Не указана попытка теста.");
      const a = await tx.questionAttempt.findFirst({
        where: {
          questionId: input.sourceId,
          testRunId: input.runId,
          testRun: { ...actor, topicId, topicVersion: topic!.version },
        },
        include: { question: true },
      });
      if (!a || a.isCorrect || a.question.archivedAt)
        throw new ContentError(
          "Объяснение доступно после неверного ответа в вашей текущей попытке.",
          409,
        );
      const q = a.question,
        options = optionsFromJSON(q.options);
      question = explainQuestion({
        prompt: q.stem,
        chosen:
          q.answerType === "SHORT_TEXT"
            ? [a.chosenText ?? ""]
            : a.chosenOptionIds.map(
                (id) => options.find((o) => o.id === id)?.text ?? "",
              ),
        answers:
          q.answerType === "SHORT_TEXT"
            ? [q.acceptedAnswers[0]]
            : q.correctOptionIds.map(
                (id) => options.find((o) => o.id === id)?.text ?? "",
              ),
        explanation: q.explanation,
      });
    }
  }
  return { subjectId, topicId: topic?.id ?? null, question };
}
export async function citationsAvailable(
  citations: Citation[],
  actor: Actor,
  db: Prisma.TransactionClient = getDb(),
) {
  for (const c of citations) {
    const topic = await db.topic.findFirst({
      where: {
        id: c.topicId,
        version: c.topicVersion,
        status: "PUBLISHED",
        subject: { status: "PUBLISHED" },
      },
    });
    if (!topic || !(await hasAccess(actor.userId ?? null, topic, db)))
      return false;
    if (!actor.userId && !topic.isFree) return false;
  }
  return true;
}
