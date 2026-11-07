import { ensureExerciseDemo } from "./exercise-demo";
import { getDb } from "../../lib/db";
import { parseTopic } from "../../lib/content/parse";
import { decodeSetting } from "../../lib/settings/defaults";
const name = new URL(process.env.DATABASE_URL!).pathname.slice(1);
if (!/^dental_preview_[a-f0-9]{12}$/.test(name))
  throw new Error("Preview seed requires its own preview database.");
const db = getDb();
const existing = await db.subject.findUnique({
  where: { slug: "platform-demo" },
});
if (!existing) {
  const threshold = decodeSetting(
    "lesson.passThreshold",
    (await db.appSetting.findUnique({ where: { key: "lesson.passThreshold" } }))
      ?.value,
  );
  const subject = await db.subject.create({
    data: {
      slug: "platform-demo",
      title: "Попробуйте платформу",
      shortDescription:
        "Тестовый просмотр: пропуски, тест и сохранение прогресса. Все примеры немедицинские, регистрация не нужна.",
      descriptionMd:
        "## Как проверить\n\nОткройте бесплатную тему, выберите варианты в пропусках и пройдите тест. Обновите страницу — ответы сохранятся в этом браузере. Соседняя закрытая тема показывает, как выглядит ограничение доступа.",
      courses: [1, 2, 3, 4, 5, 6],
      status: "PUBLISHED",
      order: -1,
    },
  });
  const section = await db.section.create({
    data: { subjectId: subject.id, title: "Знакомство с платформой" },
  });
  const markdown =
    "## Ваш первый интерактивный урок\n\nЭто тестовый просмотр платформы на немедицинских примерах. Можно нажимать на пропуски, проходить тест и обновлять страницу. Вводить личные данные не нужно.\n\n## Работа с пропусками\n\nЧтобы открыть варианты, [[нажмите на плашку|обновите страницу|закройте вкладку]].\n\nПорядок вариантов после обновления страницы [[сохраняется|всегда меняется|становится алфавитным]].\n\nВ статистику урока записывается [[первый ответ|последний клик|среднее число кликов]].\n\nЗелёная отметка означает [[верный ответ|начало урока|ожидание загрузки]].\n\nКрасная отметка помогает заметить [[ошибку|новую тему|тариф]].\n\n> [!remember] Можно ошибаться. После ответа вы увидите правильный вариант.\n\n## Проверка себя\n\nПроверить понимание помогает [[тест|меню входа|список предметов]].\n\nПосле ответа на вопрос появляется [[объяснение|платёжная форма|реклама]].\n\nВ прогрессе учитывается [[лучший результат|самый быстрый клик|первый результат навсегда]] теста.\n\nВернуться к фрагменту текста можно по ссылке [[В методичке|Выйти|Удалить]].\n\nПосле обновления этой страницы ответы [[восстановятся|исчезнут|отправятся в соцсеть]].\n\n| Элемент | Что попробовать |\n| - | - |\n| Пропуски | Выберите верный и неверный вариант |\n| Тест | Пройдите и начните заново |\n| Прогресс | Обновите страницу |";
  const rows = [
    [
      "Как открыть варианты ответа в пропуске?",
      ["Нажать на плашку", "Закрыть вкладку", "Перезагрузить устройство"],
      "a",
      "Нажатие на плашку открывает список вариантов. Также работают стрелки и Enter.",
    ],
    [
      "Какой ответ на пропуск сохраняется в статистике?",
      ["Последний", "Первый", "Самый быстрый"],
      "b",
      "Сохраняется первый ответ. «Пройти заново» позволяет тренироваться без перезаписи этой статистики.",
    ],
    [
      "Что происходит с ответами после обновления страницы?",
      ["Они исчезают", "Их нужно отправить по почте", "Они восстанавливаются"],
      "c",
      "В том же браузере ответы и незаконченный тест восстанавливаются автоматически.",
    ],
    [
      "Какой результат теста идёт в прогресс?",
      ["Лучший", "Худший", "Последний независимо от балла"],
      "a",
      "Повторный тест создаёт новую попытку. Лучший результат не уменьшается.",
    ],
    [
      "Что нужно для завершения темы?",
      [
        "Только открыть страницу",
        `Ответить на все пропуски и набрать не менее ${Math.round(threshold * 100)}% в тесте`,
        "Обязательно зарегистрироваться",
      ],
      "b",
      "Бесплатную тему можно пройти без регистрации. Для завершения нужно ответить на все пропуски и достичь проходного балла теста.",
    ],
  ] as const;
  for (const free of [true, false]) {
    const contentMd = free
      ? markdown
      : "## Пример закрытой темы\n\nЭто демонстрация платного доступа. Здесь видны только первые блоки; полная методичка и тест доступны после открытия предмета. Настоящей оплаты в тестовом просмотре нет.\n\n## Закрытая часть\n\nЭтот текст не должен попадать в HTML без доступа. Проверочный ответ [[доступ|превью|описание]].";
    const parsed = parseTopic(contentMd);
    if (parsed.errors.length) throw new Error("Invalid preview fixture");
    await db.topic.create({
      data: {
        subjectId: subject.id,
        sectionId: section.id,
        slug: free ? "first-lesson" : "locked-lesson",
        title: free ? "Как учиться на платформе" : "Как выглядит закрытая тема",
        order: free ? 0 : 1,
        isFree: free,
        status: "PUBLISHED",
        version: 1,
        publishedAt: new Date(),
        contentMd,
        readingMinutes: 4,
        needsExpertReview: false,
        authorName: "Команда платформы",
        reviewerName: "Демонстрация интерфейса",
        reviewedAt: new Date(),
        referencesMd:
          "Немедицинский пример для проверки интерфейса. Описывает только работу платформы.",
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
          create: rows.map(([stem, texts, correct, explanation], order) => ({
            stem,
            options: texts.map((text, i) => ({
              id: String.fromCharCode(97 + i),
              text,
            })),
            correctOptionIds: [correct],
            explanation,
            sourceBlockKey: parsed.blocks[1].blockKey,
            order,
          })),
        },
      },
    });
  }
}
await ensureExerciseDemo();
await db.$disconnect();
console.log(
  "Preview lessons are ready: /subjects/platform-demo and /learn/platform-demo/first-lesson",
);
