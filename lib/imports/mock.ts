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
