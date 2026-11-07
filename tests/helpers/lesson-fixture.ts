import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { parseTopic } from "../../lib/content/parse";
// Synthetic non-medical material. Never publish or approve the medical seed in tests.
export async function createLessonFixture(prefix = "lesson") {
  const db = getDb();
  const slug = `${prefix}-${randomUUID()}`;
  const subject = await db.subject.create({
    data: {
      slug,
      title: "Учебный стенд",
      shortDescription: "Синтетическая проверка обучения",
      courses: [1, 2],
      status: "PUBLISHED",
      descriptionMd: "Материал для проверки интерфейса.",
    },
  });
  const section = await db.section.create({
    data: { subjectId: subject.id, title: "Раздел проверки" },
  });
  async function topic(isFree: boolean, order: number) {
    const contentMd =
      "## Работа с материалом\n\nПервый выбор [[верный-один|неверный-один]].\n\nВторой выбор [[верный-два|неверный-два]].\n\nПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ.\n\n> [!important] Сначала прочитайте, затем ответьте.\n\n| Поле | Значение |\n| - | - |\n| Пример | Учебный |";
    const lessonMd = isFree
      ? contentMd.replace(
          "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ.",
          "Это синтетический учебный пример для проверки интерфейса.",
        )
      : contentMd;
    const parsed = parseTopic(lessonMd);
    return db.topic.create({
      data: {
        subjectId: subject.id,
        sectionId: section.id,
        slug: isFree ? "free" : "paid",
        title: isFree ? "Бесплатный учебный пример" : "Закрытый учебный пример",
        isFree,
        status: "PUBLISHED",
        contentMd: lessonMd,
        version: 1,
        order,
        needsExpertReview: false,
        readingMinutes: 3,
        authorName: "Автор фикстуры",
        reviewerName: "Рецензент фикстуры",
        reviewedAt: new Date(),
        referencesMd: "Синтетические данные без медицинских утверждений.",
        gap_topicId: {
          create: parsed.gaps.map((g) => ({
            gapKey: g.gapKey,
            blockKey: g.blockKey,
            order: g.order,
            answer: g.answer,
            distractors: g.distractors,
            sentence: g.sentence,
          })),
        },
        question_topicId: {
          create: Array.from({ length: 5 }, (_, i) => ({
            stem: `Вопрос ${i + 1}: какой вариант выбрать?`,
            options: [
              { id: "a", text: "Вариант А" },
              { id: "b", text: "Вариант Б" },
              { id: "c", text: "Вариант В" },
            ],
            correctOptionIds: ["b"],
            explanation: `ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА_${i + 1}`,
            sourceBlockKey: parsed.blocks[1].blockKey,
            order: i,
          })),
        },
      },
      include: { gap_topicId: true, question_topicId: true },
    });
  }
  return { subject, free: await topic(true, 0), paid: await topic(false, 1) };
}
export type LessonFixture = Awaited<ReturnType<typeof createLessonFixture>>;
export async function cleanupLessonFixture(
  f: LessonFixture,
  demoIds: string[] = [],
  userIds: string[] = [],
) {
  const db = getDb(),
    topicIds = [f.free.id, f.paid.id];
  const conversations = await db.tutorConversation.findMany({
    where: { subjectId: f.subject.id },
    select: { id: true },
  });
  await db.tutorMessage.deleteMany({
    where: { conversationId: { in: conversations.map((c) => c.id) } },
  });
  await db.tutorConversation.deleteMany({ where: { subjectId: f.subject.id } });
  await db.reviewLog.deleteMany({
    where: { card: { topicId: { in: topicIds } } },
  });
  await db.card.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.gapAnswer.deleteMany({
    where: { gap: { topicId: { in: topicIds } } },
  });
  await db.questionAttempt.deleteMany({
    where: { testRun: { topicId: { in: topicIds } } },
  });
  await db.testRun.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.topicProgress.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.contentChunk.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.question.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.gap.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.topic.deleteMany({ where: { id: { in: topicIds } } });
  await db.accessGrant.deleteMany({ where: { subjectId: f.subject.id } });
  await db.subscription.deleteMany({ where: { subjectId: f.subject.id } });
  await db.section.deleteMany({ where: { subjectId: f.subject.id } });
  await db.subject.delete({ where: { id: f.subject.id } });
  for (const demoSessionId of demoIds) {
    await db.usageCounter.deleteMany({
      where: { actorKey: `demo:${demoSessionId}` },
    });
  }
  await db.demoSession.deleteMany({ where: { id: { in: demoIds } } });
  for (const userId of userIds) {
    await db.usageCounter.deleteMany({ where: { actorKey: `user:${userId}` } });
    await db.accessGrant.deleteMany({
      where: { OR: [{ userId }, { grantedById: userId }] },
    });
    await db.subscription.deleteMany({ where: { userId } });
    await db.session.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
}

export async function addMixedExercises(f: LessonFixture) {
  const db = getDb();
  const contentMd =
    f.free.contentMd.replace(
      "[[верный-два|неверный-два]]",
      "[[верный-два|неверный-два|дополнительный-верный]]",
    ) + "\n\nТекстовый ответ [[=ёлка]].";
  const parsed = parseTopic(contentMd),
    multi = parsed.gaps[1],
    text = parsed.gaps[2];
  const configs = {
    [multi.gapKey]: {
      answerType: "MULTIPLE_CHOICE" as const,
      correctAnswers: [multi.answer, "дополнительный-верный"],
      acceptedAnswers: [],
      explanation: "ОБЪЯСНЕНИЕ_ПРОПУСКА_ПОСЛЕ_ОТВЕТА",
    },
    [text.gapKey]: {
      answerType: "SHORT_TEXT" as const,
      correctAnswers: [],
      acceptedAnswers: ["ель"],
      explanation: "Текстовый пример",
    },
  };
  await db.topic.update({
    where: { id: f.free.id },
    data: { contentMd, gapExercises: configs },
  });
  await db.gap.update({
    where: { id: f.free.gap_topicId.find((g) => g.order === 1)!.id },
    data: {
      answerType: "MULTIPLE_CHOICE",
      distractors: multi.distractors,
      correctAnswers: [multi.answer, "дополнительный-верный"],
      explanation: configs[multi.gapKey].explanation,
    },
  });
  await db.gap.create({
    data: {
      topicId: f.free.id,
      gapKey: text.gapKey,
      blockKey: text.blockKey,
      order: 2,
      answer: text.answer,
      distractors: [],
      sentence: text.sentence,
      answerType: "SHORT_TEXT",
      acceptedAnswers: ["ёлка", "ель"],
      explanation: "Текстовый пример",
    },
  });
  const questions = [...f.free.question_topicId].sort(
    (a, b) => a.order - b.order,
  );
  await db.question.update({
    where: { id: questions[1].id },
    data: { answerType: "MULTIPLE_CHOICE", correctOptionIds: ["a", "c"] },
  });
  await db.question.update({
    where: { id: questions[2].id },
    data: {
      answerType: "SHORT_TEXT",
      options: [],
      correctOptionIds: [],
      acceptedAnswers: ["ёлка", "ель"],
    },
  });
  return { contentMd, parsed, configs, questions };
}
