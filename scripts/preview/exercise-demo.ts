import { getDb } from "../../lib/db";
import { parseTopic } from "../../lib/content/parse";
import { gapDefinition, type GapExercises } from "../../lib/exercises";
export async function ensureExerciseDemo() {
  const db = getDb(),
    subject = await db.subject.findUniqueOrThrow({
      where: { slug: "platform-demo" },
    });
  if (
    await db.topic.findUnique({
      where: {
        subjectId_slug: { subjectId: subject.id, slug: "answer-types" },
      },
    })
  )
    return;
  const contentMd =
    "## Попробуйте три формата\n\nЭто немедицинский пример. Варианты видны сразу под абзацем. Сначала выберите или введите ответ, затем нажмите «Проверить».\n\n## Один вариант\n\nСколько дней в неделе? [[7|5|9]].\n\n## Несколько вариантов\n\nВ наборе 2, 3, 4 выберите все чётные числа: [[2|3|4]].\n\n## Короткий текст\n\nКак называется повторное обращение к изученному материалу? [[=повторение]].\n\n> [!remember] В текстовом ответе регистр, лишние пробелы и «ё/е» не влияют на результат. Синонимы задаёт автор задания.";
  const parsed = parseTopic(contentMd);
  if (parsed.errors.length) throw new Error("Invalid exercise demo");
  const gapExercises: GapExercises = {
    [parsed.gaps[1].gapKey]: {
      answerType: "MULTIPLE_CHOICE",
      correctAnswers: ["2", "4"],
      acceptedAnswers: [],
      explanation:
        "2 и 4 делятся на 2 без остатка. Нужно выбрать оба числа и не выбирать 3.",
    },
    [parsed.gaps[2].gapKey]: {
      answerType: "SHORT_TEXT",
      correctAnswers: [],
      acceptedAnswers: ["повторение материала"],
      explanation:
        "Подходят «повторение» и явно добавленная формулировка «повторение материала».",
    },
  };
  const sourceBlockKey = parsed.blocks[1].blockKey;
  const choice = (texts: string[]) =>
    texts.map((text, i) => ({ id: String.fromCharCode(97 + i), text }));
  await db.topic.create({
    data: {
      subjectId: subject.id,
      slug: "answer-types",
      title: "Три типа ответа: попробуйте сами",
      order: 1,
      isFree: true,
      status: "PUBLISHED",
      version: 1,
      publishedAt: new Date(),
      contentMd,
      gapExercises,
      readingMinutes: 3,
      needsExpertReview: false,
      authorName: "Команда платформы",
      reviewerName: "Демонстрация интерфейса",
      reviewedAt: new Date(),
      referencesMd: "Немедицинские примеры для проверки интерфейса.",
      gap_topicId: {
        create: parsed.gaps.map((g) => {
          const d = gapDefinition(g, gapExercises[g.gapKey]);
          return {
            gapKey: g.gapKey,
            blockKey: g.blockKey,
            order: g.order,
            answer: g.answer,
            distractors: g.distractors,
            sentence: g.sentence,
            answerType: d.answerType,
            correctAnswers:
              d.answerType === "SHORT_TEXT" ? [] : d.correctOptionIds,
            acceptedAnswers: d.acceptedAnswers,
            explanation: d.explanation,
          };
        }),
      },
      question_topicId: {
        create: [
          {
            stem: "Какой элемент позволяет выбрать ровно один вариант?",
            answerType: "SINGLE_CHOICE",
            options: choice(["Кружок", "Несколько чекбоксов", "Поле текста"]),
            correctOptionIds: ["a"],
            acceptedAnswers: [],
            explanation:
              "Радиокнопки позволяют выбрать один вариант из группы.",
            order: 0,
            sourceBlockKey,
          },
          {
            stem: "Выберите чётные числа.",
            answerType: "MULTIPLE_CHOICE",
            options: choice(["2", "3", "4"]),
            correctOptionIds: ["a", "c"],
            acceptedAnswers: [],
            explanation:
              "Чётные числа здесь — 2 и 4. Лишних отметок быть не должно.",
            order: 1,
            sourceBlockKey,
          },
          {
            stem: "Как называется хвойное дерево, которое часто украшают к Новому году?",
            answerType: "SHORT_TEXT",
            options: [],
            correctOptionIds: [],
            acceptedAnswers: ["ёлка", "ель"],
            explanation:
              "Допускаются «ёлка» и «ель». Написание «ЕЛКА» тоже будет засчитано.",
            order: 2,
            sourceBlockKey,
          },
          {
            stem: "Что нужно нажать после выбора или ввода ответа?",
            answerType: "SINGLE_CHOICE",
            options: choice(["Проверить", "Выйти", "Удалить"]),
            correctOptionIds: ["a"],
            acceptedAnswers: [],
            explanation: "Ответ отправляется после нажатия «Проверить».",
            order: 3,
            sourceBlockKey,
          },
          {
            stem: "Что появляется после проверки задания?",
            answerType: "MULTIPLE_CHOICE",
            options: choice(["Результат", "Объяснение", "Настоящий платёж"]),
            correctOptionIds: ["a", "b"],
            acceptedAnswers: [],
            explanation:
              "Вы увидите результат и объяснение. Это бесплатный учебный пример.",
            order: 4,
            sourceBlockKey,
          },
        ],
      },
    },
  });
}
