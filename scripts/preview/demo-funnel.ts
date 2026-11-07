import { getDb } from "../../lib/db";
import { parseTopic } from "../../lib/content/parse";
// A separate, non-medical demo fixture. Never overwrite editorial changes.
export async function ensureFunnelDemo() {
  const db = getDb();
  if (await db.subject.findUnique({ where: { slug: "learning-demo" } })) return;
  await db.$transaction(async (tx) => {
    const subject = await tx.subject.create({
      data: {
        slug: "learning-demo",
        title: "Знакомство с обучением",
        shortDescription:
          "Немедицинский пример: диагностика, урок, карточки и сохранение результата.",
        courses: [1, 2, 3, 4, 5, 6],
        order: -2,
        status: "PUBLISHED",
      },
    });
    const examples = [
      {
        slug: "practice",
        title: "Проверка понимания",
        stem: "Что помогает проверить понимание прочитанного?",
        correct: "Тест",
        wrong: "Закрытие вкладки",
      },
      {
        slug: "repeat",
        title: "Возвращение к материалу",
        stem: "Для чего нужны карточки повторения?",
        correct: "Вспоминать материал",
        wrong: "Менять пароль",
      },
      {
        slug: "sources",
        title: "Проверка источников",
        stem: "Где нужно проверять ответ тьютора?",
        correct: "В источниках",
        wrong: "В рекламном баннере",
      },
    ];
    for (const [order, row] of examples.entries()) {
      const contentMd = `## ${row.title}\n\nЭто немедицинский пример для знакомства с интерфейсом.\n\nПроверить понимание помогает [[тест|меню]].\n\nВернуться к материалу помогают [[карточки|баннеры]].\n\nОтветы тьютора нужно проверять [[в источниках|в рекламе]].\n\nЭти формулировки описывают только работу учебного сервиса.`;
      const parsed = parseTopic(contentMd);
      if (parsed.errors.length) throw new Error("Invalid demo fixture");
      await tx.topic.create({
        data: {
          subjectId: subject.id,
          slug: row.slug,
          title: row.title,
          order,
          isFree: true,
          status: "PUBLISHED",
          contentMd,
          version: 1,
          publishedAt: new Date(),
          needsExpertReview: false,
          reviewedAt: new Date(),
          authorName: "Команда платформы",
          reviewerName: "Немедицинский пример интерфейса",
          referencesMd:
            "Описание работы платформы; медицинских утверждений нет.",
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
              stem: i === 0 ? row.stem : `${row.stem} (${i + 1})`,
              options: [
                { id: "first", text: row.wrong },
                { id: "second", text: row.correct },
              ],
              correctOptionIds: ["second"],
              explanation: `Верный вариант: ${row.correct}. Это пример работы интерфейса.`,
              order: i,
              isDiagnostic: i === 0,
              sourceBlockKey: parsed.blocks[0].blockKey,
            })),
          },
        },
      });
    }
  });
}
