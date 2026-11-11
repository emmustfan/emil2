import { expect, test } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { lessonEditorExtensions } from "../../lib/editor/extensions";
import { parseTopic } from "../../lib/content/parse";
import { SafeMarkdown } from "../../components/lessons/markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { readTableSpans } from "../../lib/content/table-spans";
import { previewMarkdown } from "../../lib/content/preview";
const manager = () =>
  new MarkdownManager({ extensions: lessonEditorExtensions() });
test("visual editing preserves gaps, images, tables and formatting through storage", () => {
  const md =
    "## Заголовок\n\n**Жирный** и *курсив* и <u>подчёркнутый</u>.\n\nОтвет [[верно|неверно]] и ввод [[=пример]].\n\n> Цитата\n\n| Поле | Значение |\n| --- | --- |\n| А | Б |\n\n![Подпись](/api/content-images/00000000-0000-4000-8000-000000000001)";
  const m = manager(),
    json = m.parse(md),
    out = m.serialize(json),
    before = parseTopic(md),
    after = parseTopic(out);
  expect(JSON.stringify(json)).toContain("lessonGap");
  expect(JSON.stringify(json)).toContain("underline");
  expect(out).toContain("[[верно|неверно]]");
  expect(out).toContain("[[=пример]]");
  expect(out).toContain("<u>подчёркнутый</u>");
  expect(out).toContain("> Цитата");
  expect(out).toContain("![Подпись]");
  expect(out).toContain("|");
  expect(after.errors).toEqual([]);
  expect(after.gaps.map((g) => g.gapKey)).toEqual(
    before.gaps.map((g) => g.gapKey),
  );
});
test("underline is rendered without enabling raw HTML or active attributes", () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown
      markdown={
        '<u>Текст **жирный**</u> <u onclick="alert(1)">безопасно</u><script>alert(1)</script>'
      }
    />,
  );
  expect(html).toContain("<u>Текст <strong>жирный</strong></u>");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("onclick");
});
test("visual editor does not load external or embedded images from pasted material", () => {
  const m = manager();
  for (const source of [
    "https://example.test/tracker.png",
    "http://127.0.0.1/private",
    "data:image/svg+xml,unsafe",
  ]) {
    const json = m.parse(`![Подпись](${source})`);
    expect(JSON.stringify(json)).not.toContain('"type":"image"');
    expect(JSON.stringify(json)).not.toContain(source);
  }
});
test("merged rows and columns survive editing, storage and student rendering", () => {
  const paragraph = (text: string) => [
    { type: "paragraph", content: [{ type: "text", text }] },
  ];
  const cell = (text: string, rowspan = 1, colspan = 1) => ({
    type: "tableCell",
    attrs: { rowspan, colspan },
    content: paragraph(text),
  });
  const m = manager(),
    original = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: ["A", "B", "C"].map((text) => ({
                type: "tableHeader",
                content: paragraph(text),
              })),
            },
            {
              type: "tableRow",
              content: [
                {
                  ...cell("Общий", 2, 2),
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "Общий " },
                        {
                          type: "lessonGap",
                          attrs: { source: "[[ответ|ошибка]]" },
                        },
                      ],
                    },
                  ],
                },
                cell("Справа"),
              ],
            },
            { type: "tableRow", content: [cell("Последняя")] },
          ],
        },
      ],
    };
  const out = m.serialize(original);
  expect(out).toContain("<!-- emal-table:v1 [[1,0,2,2]] -->");
  const restored = m.parse(out),
    table = restored.content![0];
  expect(table.content![1].content![0].attrs).toMatchObject({
    rowspan: 2,
    colspan: 2,
  });
  expect(table.content![2].content).toHaveLength(1);
  expect(m.serialize(restored)).toBe(out);
  const parsed = parseTopic(out);
  expect(parsed.errors).toEqual([]);
  expect(parsed.gaps).toHaveLength(1);
  expect(parsed.blocks[0].markdown).toContain("<!-- emal-table:v1");
  const html = renderToStaticMarkup(
    <SafeMarkdown markdown={previewMarkdown(out, parsed)} />,
  );
  expect(html).toContain('rowSpan="2"');
  expect(html).toContain('colSpan="2"');
  expect(html).toContain("Последняя");
  expect(html).not.toContain("<thead>");
  expect(html).not.toContain("emal-table");
});
test("table metadata cannot add attributes, overlap cells or allocate unbounded spans", () => {
  for (const value of [
    "[[0,0,1000000,1000000]]",
    "[[0,0,2,2],[1,1,1,1]]",
    '[[0,0,1,"onclick"]]',
    "[[0,0,1,1,9]]",
    '{"onclick":"unsafe"}',
  ]) {
    const marker = `<!-- emal-table:v1 ${value} -->`;
    expect(readTableSpans(marker, 3, 3)).toBeNull();
    const md = `${marker}\n| A | B |\n| --- | --- |\n| C | D |`;
    expect(parseTopic(md).errors.some((e) => e.code === "table_spans")).toBe(
      true,
    );
    expect(renderToStaticMarkup(<SafeMarkdown markdown={md} />)).not.toContain(
      "onclick=",
    );
  }
  const shortRow =
    "<!-- emal-table:v1 [[1,1,1,1]] -->\n| A | B |\n| --- | --- |\n| C |";
  expect(
    parseTopic(shortRow).errors.some((e) => e.code === "table_spans"),
  ).toBe(true);
  expect(() =>
    renderToStaticMarkup(<SafeMarkdown markdown={shortRow} />),
  ).not.toThrow();
});
