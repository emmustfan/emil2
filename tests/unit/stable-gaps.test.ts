import { describe, expect, it, vi } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { lessonEditorExtensions } from "../../lib/editor/extensions";
import { parseTopic } from "../../lib/content/parse";
import {
  stabilizeGapIds,
  pinLegacyGapIds,
  correctGapAnswersChanged,
  existingGapIdentities,
} from "../../lib/content/gap-identity";
import { gapSourceId, gapSourceLabel } from "../../lib/content/gap-id";
import {
  createGapMarkdown,
  gapExercisesSchema,
  gapExerciseFor,
  gapDefinition,
  type Definition,
} from "../../lib/exercises";
import { publicBlocks } from "../../lib/lessons/public";
import {
  lockTopicForLearning,
  lockTopicForChange,
} from "../../lib/content/locks";
import type { Prisma } from "../../lib/generated/prisma/client";

describe("stable gap identities", () => {
  it("keeps IDs when context changes and gaps move; parses choice and text answers", () => {
    const first = parseTopic(
      "Первый [[#abc123 ответ|нет]]. Второй [[#def456 =ёлка]].",
    );
    const edited = parseTopic(
      "Иначе [[#def456 =ёлка]].\n\nНовая формулировка [[#abc123 ответ|иной]].",
    );
    expect(first.errors).toEqual([]);
    expect(edited.errors).toEqual([]);
    expect(first.gaps.map((g) => g.gapKey)).toEqual(["abc123", "def456"]);
    expect(edited.gaps.map((g) => g.gapKey)).toEqual(["def456", "abc123"]);
    expect(edited.gaps[0]).toMatchObject({
      answer: "ёлка",
      answerType: "SHORT_TEXT",
    });
    expect(edited.blocks[0].text).not.toContain("#def456");
  });

  it("pins existing legacy hashes on first save and in the read-only author view", () => {
    const md = "Текст [[ответ|нет]]. И [[=пример]].";
    const before = parseTopic(md),
      keys = new Set(before.gaps.map((g) => g.gapKey));
    const config = {
      answerType: "SINGLE_CHOICE" as const,
      correctAnswers: ["ответ"],
      acceptedAnswers: [],
      explanation: "Пояснение",
    };
    const exercises = { [before.gaps[0].gapKey]: config };
    const result = stabilizeGapIds(md, exercises, keys);
    expect(result).toEqual(pinLegacyGapIds(md, exercises, keys));
    expect(parseTopic(result.contentMd).gaps.map((g) => g.gapKey)).toEqual([
      ...keys,
    ]);
    expect(result.gapExercises).toEqual(exercises);
    expect(
      stabilizeGapIds(result.contentMd, result.gapExercises, keys),
    ).toEqual(result);
    expect(pinLegacyGapIds("Новый [[ответ|нет]].", {}, keys).contentMd).toBe(
      "Новый [[ответ|нет]].",
    );
  });

  it("assigns short IDs to new gaps and copies settings when a duplicate is pasted", () => {
    const md =
      "Один [[#abc123 ответ|нет]]. Другой [[#abc123 ответ|нет]]. Новый [[=слово]].";
    const config = {
      answerType: "SINGLE_CHOICE" as const,
      correctAnswers: ["ответ"],
      acceptedAnswers: [],
      explanation: "Сохранить и в копии",
    };
    const generate = vi
      .fn()
      .mockReturnValueOnce("abc123")
      .mockReturnValueOnce("new001")
      .mockReturnValue("new002");
    const result = stabilizeGapIds(md, { abc123: config }, new Set(), generate);
    const parsed = parseTopic(result.contentMd);
    expect(parsed.errors).toEqual([]);
    expect(parsed.gaps.map((g) => g.gapKey)).toEqual([
      "abc123",
      "new001",
      "new002",
    ]);
    expect(result.gapExercises.new001).toEqual(config);
    expect(result.gapExercises.abc123).toEqual(config);
    expect(stabilizeGapIds(result.contentMd, result.gapExercises)).toEqual(
      result,
    );
  });

  it("renames copied legacy IDs and leaves code, escaped markup and table metadata alone", () => {
    const legacy = "a".repeat(40);
    const md = `[[#${legacy} ответ|нет]]. [[#${legacy} ответ|нет]].\n\n\`[[код|нет]]\` и \\[[экранирован|нет]]`;
    const result = stabilizeGapIds(md);
    expect(parseTopic(result.contentMd).gaps.map((g) => g.gapKey)).toEqual([
      legacy,
      expect.stringMatching(/^[a-z0-9]{6,12}$/),
    ]);
    expect(result.contentMd).toContain("`[[код|нет]]`");
    expect(result.contentMd).toContain("\\[[экранирован|нет]]");
    const table =
      "<!-- emal-table:v1 [[1,0,1,2]] -->\n| A | B |\n| --- | --- |\n| [[да|нет]] | |";
    const stable = stabilizeGapIds(table);
    expect(stable.contentMd).toContain("<!-- emal-table:v1 [[1,0,1,2]] -->");
    expect(parseTopic(stable.contentMd).errors).toEqual([]);
  });

  it.each(["ABC123", "abc_12", "tiny", "a".repeat(13), "z".repeat(40)])(
    "rejects invalid explicit ID %s",
    (id) => {
      expect(parseTopic(`[[#${id} ответ|нет]]`).errors).toEqual([
        expect.objectContaining({ code: "gap_id" }),
      ]);
      expect(
        gapExercisesSchema.safeParse({ [id]: { answerType: "SHORT_TEXT" } })
          .success,
      ).toBe(false);
    },
  );

  it("round-trips through TipTap and keeps identity when the gap dialog changes options", () => {
    const manager = new MarkdownManager({
      extensions: lessonEditorExtensions(),
    });
    const md = "Контекст [[#abc123 ответ|нет]]. Ввод [[#def456 =слово]].";
    const doc = manager.parse(md);
    expect(manager.serialize(doc)).toContain("[[#abc123 ответ|нет]]");
    const definition: Definition = {
      answerType: "SINGLE_CHOICE",
      options: [
        { id: "a", text: "другой ответ" },
        { id: "b", text: "ошибка" },
      ],
      correctOptionIds: ["a"],
      acceptedAnswers: [],
      explanation: "Пояснение",
    };
    const source = createGapMarkdown(
      "____",
      definition,
      gapSourceId("[[#abc123 ответ|нет]]"),
    ).markdown;
    for (const node of doc.content![0].content!) {
      if (
        node.type === "lessonGap" &&
        gapSourceId(String(node.attrs!.source)) === "abc123"
      )
        node.attrs!.source = source;
      if (node.type === "text") node.text = "Изменённая формулировка ";
    }
    const result = manager.serialize(doc);
    expect(parseTopic(result).gaps.map((g) => g.gapKey)).toEqual([
      "abc123",
      "def456",
    ]);
    expect(parseTopic(result).gaps[0].answer).toBe("другой ответ");
    expect(gapSourceLabel(source)).toBe("другой ответ");
    expect(gapSourceLabel("[[#def456 =слово]]")).toBe("слово");
    const wire = JSON.stringify(
      publicBlocks(
        result,
        new Map([
          ["abc123", "row-1"],
          ["def456", "row-2"],
        ]),
      ),
    );
    expect(wire).not.toContain("abc123");
    expect(wire).not.toContain("def456");
    expect(wire).not.toContain("другой ответ");
  });

  it("compares correct answer sets, ignoring order, distractors and equivalent text spelling", () => {
    const before = {
      answerType: "MULTIPLE_CHOICE",
      answer: "А",
      correctAnswers: ["А", "Б"],
      acceptedAnswers: [],
    };
    expect(
      correctGapAnswersChanged(before, {
        ...before,
        correctAnswers: ["Б", "а"],
      }),
    ).toBe(false);
    expect(
      correctGapAnswersChanged(before, {
        ...before,
        correctAnswers: ["А", "В"],
      }),
    ).toBe(true);
    const text = {
      answerType: "SHORT_TEXT",
      answer: "ёлка",
      correctAnswers: [],
      acceptedAnswers: ["ёлка", "ель"],
    };
    expect(
      correctGapAnswersChanged(text, {
        ...text,
        acceptedAnswers: ["ЕЛЬ", " елка "],
      }),
    ).toBe(false);
    expect(
      correctGapAnswersChanged(text, { ...text, acceptedAnswers: ["ёлка"] }),
    ).toBe(true);
  });

  it("accepts valid IDs that match object property names without inheriting settings", () => {
    const result = stabilizeGapIds("[[#constructor ответ|нет]]");
    const gap = parseTopic(result.contentMd).gaps[0];
    expect(result.gapExercises).toEqual({});
    expect(gapExerciseFor(result.gapExercises, gap.gapKey)).toBeUndefined();
    expect(
      gapDefinition(gap, gapExerciseFor({}, gap.gapKey)).correctOptionIds,
    ).toEqual(["ответ"]);
  });

  it("preserves an assigned ID for legacy API clients only when the content match is unambiguous", () => {
    const md = "Контекст [[ответ|нет]].",
      gap = parseTopic(md).gaps[0];
    const source = {
      gapKey: "abc123",
      sentence: gap.sentence,
      answer: gap.answer,
    };
    const unique = existingGapIdentities([source]);
    expect(
      parseTopic(stabilizeGapIds(md, {}, unique).contentMd).gaps[0].gapKey,
    ).toBe("abc123");
    const ambiguous = existingGapIdentities([
      source,
      { ...source, gapKey: "def456" },
    ]);
    const generate = vi
      .fn()
      .mockReturnValueOnce("abc123")
      .mockReturnValueOnce("def456")
      .mockReturnValue("new001");
    expect(
      parseTopic(stabilizeGapIds(md, {}, ambiguous, generate).contentMd).gaps[0]
        .gapKey,
    ).toBe("new001");
  });
});

it("uses one content key, shared for learning, editor then exclusive for changes", async () => {
  const calls: { sql: string; key: string }[] = [];
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray, key: string) => {
      calls.push({ sql: sql.join("?"), key });
      return 0;
    },
  } as unknown as Prisma.TransactionClient;
  await lockTopicForLearning(tx, "topic-1");
  await lockTopicForChange(tx, "topic-1");
  expect(calls.map((call) => call.key)).toEqual([
    "content:topic:topic-1",
    "topic:topic-1",
    "content:topic:topic-1",
  ]);
  expect(calls[0].sql).toContain("pg_advisory_xact_lock_shared(");
  expect(calls[1].sql).toContain("pg_advisory_xact_lock(");
  expect(calls[2].sql).toContain("pg_advisory_xact_lock(");
});
