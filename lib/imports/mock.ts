import { parseTopic } from "../content/parse";
// Development fixture: demonstrates the pipeline, never claims medical quality.
export function mockImport(source: string) {
  const words = source.match(/[\p{L}]{4,}/gu) ?? [];
  const unique = [
    ...new Map(
      words.map((word) => [word.toLocaleLowerCase("ru"), word]),
    ).values(),
  ].slice(0, 30);
  if (unique.length < 3)
    throw new Error("Недостаточно текста для технического черновика.");
  const sentences = source
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  const paragraphs = Array.from({ length: 15 }, (_, i) => {
    const sentence = (sentences[i % Math.max(1, sentences.length)] || source)
      .slice(0, 500)
      .replace(/[\[\]<>|`*_!#]/g, "");
    const term = sentence.match(/[\p{L}]{4,}/u)?.[0] || unique[0];
    const others = unique
      .filter((w) => w.toLowerCase() !== term.toLowerCase())
      .slice(0, 2);
    return `Фрагмент ${i + 1}: ${sentence.replace(term, `в примере ${i + 1} [[${term}|${others.join("|")}]]`)}`;
  });
  const contentMd =
    "# Технический черновик — тестовый ИИ\n\nЭто результат тестового режима. Содержимое и задания должен переработать преподаватель.\n\n" +
    paragraphs.join("\n\n");
  const parsed = parseTopic(contentMd);
  return {
    title: "Технический черновик — тестовый ИИ",
    contentMd,
    questions: parsed.gaps.slice(0, 10).map((g, i) => ({
      answerType: "SINGLE_CHOICE",
      acceptedAnswers: [],
      stem: `Какое слово пропущено в фрагменте ${i + 1}: ${g.sentence}`,
      options: [g.answer, ...g.distractors].map((text, n) => ({
        id: ["a", "b", "c"][n],
        text,
      })),
      correctOptionIds: ["a"],
      explanation: `Сверьте формулировку с исходным текстом: ${g.answer}. Это технический пример, требующий проверки.`,
      sourceBlockKey: g.blockKey,
      isDiagnostic: i < 3,
      order: i,
    })),
  };
}

export function mockVideoImport(source: {
  cues: import("./subtitles").Cue[];
  text: string;
}) {
  const fragments = source.cues.length
    ? source.cues.slice(0, 10)
    : [{ fromSec: null, toSec: 0, text: source.text.slice(0, 500) }];
  const question = (item: (typeof fragments)[number], index: number) => ({
    answerType: "SINGLE_CHOICE",
    stem: `Демо-вопрос ${index + 1}: какая фраза есть в источнике?`,
    options: [
      { id: "a", text: item.text.slice(0, 500) },
      { id: "b", text: "Произвольный пример Б" },
      { id: "c", text: "Произвольный пример В" },
    ],
    correctOptionIds: ["a"],
    explanation: "Демонстрация привязки вопроса к фрагменту исходника.",
    sourceQuote: item.text.slice(0, 500),
    sourceSec: item.fromSec === null ? null : Math.floor(item.fromSec),
  });
  const checkpoints = source.cues.length
    ? fragments.map((cue, i) => ({
        ...question(cue, i),
        atSec: Math.ceil(cue.toSec),
      }))
    : [];
  const testQuestions = Array.from(
    { length: Math.max(5, fragments.length) },
    (_, i) => question(fragments[i % fragments.length], i),
  );
  testQuestions.push({
    ...testQuestions[0],
    sourceQuote: "Искусственная цитата, которой нет в источнике ФИКСТУРА.",
  });
  return {
    checkpoints,
    testQuestions,
    summaryMd: Array.from(
      { length: 10 },
      (_, i) =>
        `Демонстрационная строка ${i + 1} содержит [[текст-${i + 1}|вариант-${i + 1}]].`,
    ).join("\n\n"),
  };
}
