import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createGapMarkdown,
  gradeAnswer,
  normalizeAnswer,
  gapDefinition,
  definitionErrors,
  type Definition,
} from "../../lib/exercises";
import { questionFields } from "../../lib/content/validation";
import { parseTopic, makeGapKey } from "../../lib/content/parse";
import { publicBlocks } from "../../lib/lessons/public";
import { AnswerCard } from "../../components/exercises/answer-card";
import { gapAnswerInput, testAnswerInput } from "../../lib/lessons/http";
const single: Definition = {
  answerType: "SINGLE_CHOICE",
  options: [
    { id: "a", text: "Первый" },
    { id: "b", text: "Второй" },
    { id: "c", text: "Третий" },
  ],
  correctOptionIds: ["a"],
  acceptedAnswers: [],
  explanation: "Пояснение",
};
describe("exercise definitions and grading", () => {
  it("requires exactly one choice for single-answer tasks", () => {
    expect(gradeAnswer(single, { optionIds: ["a"] }).isCorrect).toBe(true);
    expect(gradeAnswer(single, { optionIds: ["b"] }).isCorrect).toBe(false);
    for (const optionIds of [[], ["a", "b"], ["forged"]])
      expect(() => gradeAnswer(single, { optionIds })).toThrow();
  });
  it("accepts exactly the full multi-answer set, independent of order", () => {
    const multi = {
      ...single,
      answerType: "MULTIPLE_CHOICE" as const,
      correctOptionIds: ["a", "c"],
    };
    expect(gradeAnswer(multi, { optionIds: ["c", "a"] }).isCorrect).toBe(true);
    for (const ids of [["a"], ["a", "b", "c"], ["b"]])
      expect(gradeAnswer(multi, { optionIds: ids }).isCorrect).toBe(false);
    expect(() => gradeAnswer(multi, { optionIds: ["a", "a"] })).toThrow();
    expect(definitionErrors({ ...multi, correctOptionIds: ["a"] })).not.toEqual(
      [],
    );
  });
  it("normalizes only whitespace, case and ё/е and accepts explicit aliases", () => {
    const text = {
      ...single,
      answerType: "SHORT_TEXT" as const,
      options: [],
      correctOptionIds: [],
      acceptedAnswers: ["Зелёная ёлка", "ель"],
    };
    expect(normalizeAnswer("  ЗЕЛЁНАЯ  ёЛКА ")).toBe("зеленая елка");
    expect(gradeAnswer(text, { text: " зеленая   ЕЛКА " }).isCorrect).toBe(
      true,
    );
    expect(gradeAnswer(text, { text: "ЕЛЬ" }).isCorrect).toBe(true);
    expect(gradeAnswer(text, { text: "зелёная сосна" }).isCorrect).toBe(false);
    expect(gradeAnswer(text, { text: "зелёная ёлка!" }).isCorrect).toBe(false);
    expect(() => gradeAnswer(text, { text: " " })).toThrow();
    expect(() =>
      gradeAnswer(text, { text: "ель", optionIds: ["a"] }),
    ).toThrow();
    expect(
      definitionErrors({ ...text, acceptedAnswers: ["ЁЛКА", "елка"] }),
    ).not.toEqual([]);
  });
  it("validates all question types and rejects incompatible fields", () => {
    const q = {
      ...single,
      stem: "Вопрос",
      sourceBlockKey: null,
      isDiagnostic: false,
      order: 0,
    };
    expect(questionFields.safeParse(q).success).toBe(true);
    expect(
      questionFields.safeParse({
        ...q,
        answerType: "MULTIPLE_CHOICE",
        correctOptionIds: ["a", "b"],
      }).success,
    ).toBe(true);
    expect(
      questionFields.safeParse({
        ...q,
        answerType: "SHORT_TEXT",
        options: [],
        correctOptionIds: [],
        acceptedAnswers: ["эталон", "синоним"],
      }).success,
    ).toBe(true);
    for (const changed of [
      { answerType: "SHORT_TEXT", acceptedAnswers: ["a"] },
      {
        answerType: "SHORT_TEXT",
        options: [],
        correctOptionIds: [],
        acceptedAnswers: [],
      },
      { correctOptionIds: ["a", "a"] },
      { acceptedAnswers: ["утечка"] },
    ])
      expect(questionFields.safeParse({ ...q, ...changed }).success).toBe(
        false,
      );
  });
  it("parses explicit text gaps with stable legacy identities and strips canonical text", () => {
    const old = parseTopic("Ответ [[ёлка|сосна]]."),
      fresh = parseTopic("Ответ [[=ёлка]].");
    expect(fresh.errors).toEqual([]);
    expect(fresh.gaps[0].answerType).toBe("SHORT_TEXT");
    expect(fresh.gaps[0].gapKey).toBe(old.gaps[0].gapKey);
    const blocks = publicBlocks(
      "Ответ [[=ёлка]].",
      new Map([[fresh.gaps[0].gapKey, "text-gap"]]),
    );
    expect(JSON.stringify(blocks)).not.toContain("ёлка");
    expect(parseTopic("[[=]]").errors.length).toBeGreaterThan(0);
    expect(parseTopic("[[=a|b]]").gaps[0]).toMatchObject({
      answer: "=a",
      answerType: "SINGLE_CHOICE",
    });
  });
  it("validates gap overrides against the current options", () => {
    const gap = parseTopic("[[да|нет|возможно]]").gaps[0];
    expect(gapDefinition(gap).correctOptionIds).toEqual(["да"]);
    expect(
      gapDefinition(
        { ...gap, answer: "ДА" },
        {
          answerType: "SINGLE_CHOICE",
          correctAnswers: ["да"],
          acceptedAnswers: [],
          explanation: "",
        },
      ).correctOptionIds,
    ).toEqual(["ДА"]);
    expect(
      definitionErrors({
        ...single,
        options: [
          { id: "a", text: "Ёлка" },
          { id: "b", text: "Елка" },
          { id: "c", text: "Сосна" },
        ],
      }),
    ).toEqual([]);
    expect(() =>
      gapDefinition(gap, {
        answerType: "MULTIPLE_CHOICE",
        correctAnswers: ["да", "missing"],
        acceptedAnswers: [],
        explanation: "",
      }),
    ).toThrow();
    expect(() =>
      gapDefinition(gap, {
        answerType: "MULTIPLE_CHOICE",
        correctAnswers: ["нет", "возможно"],
        acceptedAnswers: [],
        explanation: "",
      }),
    ).toThrow();
    expect(makeGapKey("____", "да")).toHaveLength(40);
  });
  it("rejects empty/mixed public payloads while keeping legacy single requests", () => {
    expect(
      gapAnswerInput.safeParse({ version: 1, optionId: "a".repeat(64) })
        .success,
    ).toBe(true);
    expect(gapAnswerInput.safeParse({ version: 1, text: "ель" }).success).toBe(
      true,
    );
    expect(
      gapAnswerInput.safeParse({
        version: 1,
        text: "ель",
        optionIds: ["a".repeat(64)],
      }).success,
    ).toBe(false);
    expect(
      testAnswerInput.safeParse({
        runId: "r",
        questionId: "q",
        optionIds: ["a", "b"],
      }).success,
    ).toBe(true);
    expect(
      testAnswerInput.safeParse({ runId: "r", questionId: "q" }).success,
    ).toBe(false);
  });
  it("renders visible accessible choices or an empty text field without correctness", () => {
    for (const [answerType, inputType] of [
      ["SINGLE_CHOICE", "radio"],
      ["MULTIPLE_CHOICE", "checkbox"],
    ] as const) {
      const html = renderToStaticMarkup(
        <AnswerCard
          id="q"
          title="Вопрос"
          answerType={answerType}
          options={single.options}
          feedback={null}
          onAnswer={() => {}}
        />,
      );
      expect(html).toContain(`type="${inputType}"`);
      expect(html).toContain("Проверить");
      expect(html).not.toContain('role="menu"');
      expect(html).not.toContain("Правильный ответ");
    }
    const html = renderToStaticMarkup(
      <AnswerCard
        id="t"
        title="Введите ответ"
        answerType="SHORT_TEXT"
        options={[]}
        feedback={null}
        onAnswer={() => {}}
      />,
    );
    expect(html).toContain('value=""');
  });
  it("builds editable Markdown and config from all constructor types", () => {
    expect(createGapMarkdown("Слово ____.", single).markdown).toBe(
      "Слово [[Первый|Второй|Третий]].",
    );
    const multi = createGapMarkdown("____", {
      ...single,
      answerType: "MULTIPLE_CHOICE",
      correctOptionIds: ["a", "c"],
    });
    expect(multi.config.correctAnswers).toEqual(["Первый", "Третий"]);
    const text = createGapMarkdown("____", {
      ...single,
      answerType: "SHORT_TEXT",
      options: [],
      correctOptionIds: [],
      acceptedAnswers: ["ёлка", "ель"],
    });
    expect(text.markdown).toBe("[[=ёлка]]");
    expect(text.config.acceptedAnswers).toEqual(["ель"]);
    expect(() => createGapMarkdown("Нет места", single)).toThrow();
    expect(() => createGapMarkdown("____ и ____", single)).toThrow();
    expect(() =>
      createGapMarkdown("____", {
        ...single,
        options: [{ id: "a", text: "x|y" }, ...single.options.slice(1)],
      }),
    ).toThrow();
  });
});
