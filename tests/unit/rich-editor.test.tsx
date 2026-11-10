import { expect, test } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { lessonEditorExtensions } from "../../lib/editor/extensions";
import { parseTopic } from "../../lib/content/parse";
import { SafeMarkdown } from "../../components/lessons/markdown";
import { renderToStaticMarkup } from "react-dom/server";
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
