import { createLessonFixture } from "./lesson-fixture";
import { getDb } from "../../lib/db";
export async function createDemoFixture(prefix: string) {
  const f = await createLessonFixture(prefix),
    db = getDb();
  await db.topic.update({ where: { id: f.paid.id }, data: { isFree: true } });
  const third = await db.topic.create({
    data: {
      subjectId: f.subject.id,
      sectionId: f.free.sectionId,
      slug: "diagnostic-third",
      title: "Третья тема диагностики",
      order: 3,
      isFree: true,
      status: "PUBLISHED",
      needsExpertReview: false,
      reviewedAt: new Date(),
      version: 1,
      contentMd: "## Пример\n\nНемедицинская третья тема.",
      question_topicId: {
        create: {
          stem: "Третий диагностический вопрос",
          options: [
            { id: "a", text: "Вариант А" },
            { id: "b", text: "Вариант Б" },
          ],
          correctOptionIds: ["b"],
          explanation: "СЕКРЕТ_ТРЕТЬЕГО_ВОПРОСА",
          isDiagnostic: true,
        },
      },
    },
  });
  for (const topicId of [f.free.id, f.paid.id])
    await db.question.update({
      where: {
        id: (topicId === f.free.id ? f.free : f.paid).question_topicId[0].id,
      },
      data: { isDiagnostic: true },
    });
  return { ...f, third };
}
