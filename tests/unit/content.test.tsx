import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  parseTopic,
  makeGapKey,
  normalizeSentence,
  MAX_MARKDOWN_CHARS,
} from "../../lib/content/parse";
import { questionFields } from "../../lib/content/validation";
import { headingSlug } from "../../lib/content/slug";
import { MarkdownPreview } from "../../components/content/markdown-preview";
describe("topic parser", () => {
  it("extracts stable gaps, source blocks and line numbers", () => {
    const parsed = parseTopic(
      "## Проверка\n\nВопрос [[ответ|ошибка|другое]].\n\nСледующий [[вариант|иной]].",
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.gaps).toHaveLength(2);
    expect(parsed.gaps[0]).toMatchObject({
      answer: "ответ",
      distractors: ["ошибка", "другое"],
      sentence: "Вопрос ____.",
      line: 3,
      blockKey: "proverka-1",
    });
    expect(parsed.blocks.map((b) => b.blockKey)).toEqual([
      "proverka-0",
      "proverka-1",
      "proverka-2",
    ]);
    expect(parsed.gaps[0].gapKey).toBe(makeGapKey("Вопрос ____.", "ответ"));
    expect(
      parseTopic(
        "## Проверка\n\nВопрос [[ответ|ошибка|другое]].\n\nДругой абзац.",
      ).gaps[0].gapKey,
    ).toBe(parsed.gaps[0].gapKey);
  });
  it("normalizes identity while keeping distractors out of the key", () => {
    expect(makeGapKey("  ВОПРОС   ____.  ", "Ответ")).toBe(
      makeGapKey("вопрос ____.", "ответ"),
    );
    expect(parseTopic("Вопрос [[ответ|нет]].").gaps[0].gapKey).toBe(
      parseTopic("Вопрос [[ответ|другой отвлекающий]].").gaps[0].gapKey,
    );
    expect(normalizeSentence(" Ａ  Б ")).toBe("a б");
    expect(headingSlug("Нумерация зубов · FDI")).toBe("numeratsiya-zubov-fdi");
  });
  it("handles several gaps in one sentence and decimal numbers", () => {
    const result = parseTopic(
      "Число 3.5: [[первый|иной]] и [[второй|третий]]. Следом [[да|нет]].",
    );
    expect(result.errors).toEqual([]);
    expect(result.gaps).toHaveLength(3);
    expect(result.gaps[0].sentence).toBe("Число 3.5: ____ и ____.");
    expect(result.gaps[2].sentence).toBe("Следом ____.");
  });
  it("supports tables with ordinary and Markdown-escaped option separators", () => {
    const source =
      "| Вопрос | Ответ |\n| --- | --- |\n| Первый | [[да|нет]] |\n| Второй | [[один\\|два]] |";
    const result = parseTopic(source);
    expect(result.errors).toEqual([]);
    expect(result.gaps.map((g) => g.answer)).toEqual(["да", "один"]);
    expect(result.blocks[0].kind).toBe("table");
  });
  it("ignores code, escaped brackets and raw HTML, preserving reference links", () => {
    const result = parseTopic(
      "`[[код|нет]]` и \\[[текст|нет]]\n\n```md\n[[код|нет]]\n```\n\n<script>[[html|нет]]</script>\n\n[ссылка][ref] [[да|нет]].\n\n[ref]: https://example.test",
    );
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].answer).toBe("да");
    expect(result.errors).toEqual([]);
  });
  it.each([
    ["[[ответ]]", "options_count"],
    ["[[a|b|c|d|e|f]]", "options_count"],
    ["[[a|]]", "empty_option"],
    ["[[ A |a]]", "duplicate_option"],
    ["[[a|b]", "unclosed"],
    ["[[a|[[b|c]]]]", "nested"],
    ["Лишнее ]].", "broken_markup"],
    ["[[a|**b**]]", "unclosed"],
  ])("rejects invalid syntax %s", (source, code) => {
    const parsed = parseTopic(`## Тема\n\n${source}`);
    expect(parsed.errors.some((e) => e.code === code && e.line >= 3)).toBe(
      true,
    );
  });
  it("rejects duplicate gap identity, unsupported images and excessive content", () => {
    expect(
      parseTopic("Одинаковый [[a|b]].\n\nОдинаковый [[a|b]].").errors.some(
        (e) => e.code === "duplicate_gap",
      ),
    ).toBe(true);
    expect(
      parseTopic("![Фото](https://example.test/a.png)").errors[0].code,
    ).toBe("image");
    expect(parseTopic("x".repeat(MAX_MARKDOWN_CHARS + 1)).errors[0].code).toBe(
      "too_large",
    );
  });
  it("keeps both existing demo fixtures valid", () => {
    for (const name of ["fdi-numbering", "primary-dentition"]) {
      const raw = readFileSync(
        `content-seed/propaedeutics/${name}.md`,
        "utf8",
      ).split(/^---\s*$/m)[2];
      const result = parseTopic(raw);
      expect(result.errors).toEqual([]);
      expect(result.gaps).toHaveLength(10);
      expect(new Set(result.gaps.map((g) => g.gapKey)).size).toBe(10);
    }
  });
});
describe("question validation and safe preview", () => {
  const q = {
    stem: "Выберите вариант",
    options: [
      { id: "a", text: "Первый" },
      { id: "b", text: "Второй" },
      { id: "c", text: "Третий" },
    ],
    correctOptionIds: ["a"],
    explanation: "Тестовое объяснение",
    sourceBlockKey: null,
    isDiagnostic: false,
    order: 0,
  };
  it("requires 3–5 distinct options and exactly one existing correct option", () => {
    expect(questionFields.safeParse(q).success).toBe(true);
    for (const changed of [
      { options: q.options.slice(0, 2) },
      { correctOptionIds: [] },
      { correctOptionIds: ["z"] },
      { correctOptionIds: ["a", "b"] },
      { options: [q.options[0], q.options[0], q.options[2]] },
    ])
      expect(questionFields.safeParse({ ...q, ...changed }).success).toBe(
        false,
      );
  });
  it("renders safe Markdown with anchors, callouts and reference links", () => {
    const md =
      "## Раздел\n\n> [!important]\n> Учебное замечание.\n\n[Источник][ref] и [[ответ|ошибка]].\n\n[ref]: https://example.test";
    const html = renderToStaticMarkup(
      <MarkdownPreview markdown={md} parsed={parseTopic(md)} />,
    );
    expect(html).toContain('id="b-razdel-1"');
    expect(html).toContain("Важно");
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain("Выберите один вариант");
  });
  it("removes active HTML, images and unsafe link protocols", () => {
    const md =
      '<script>window.secret=1</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://attacker.example"></iframe>\n\n[x](javascript:alert%281%29) [[ответ|ошибка]].';
    const html = renderToStaticMarkup(
      <MarkdownPreview markdown={md} parsed={parseTopic(md)} />,
    );
    expect(html).not.toMatch(/<script|<iframe|<img|onerror|javascript:/i);
    expect(html).toContain("____");
  });
});
