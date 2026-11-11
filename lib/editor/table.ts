import { Table } from "@tiptap/extension-table";
import type { JSONContent } from "@tiptap/core";
import {
  readTableSpans,
  TABLE_SPAN_PREFIX,
  type CellSpan,
} from "../content/table-spans";

const base = Table.config;
const restoreGapPipes = (text: string) =>
  text.replace(/\[\[[^\n]*?\]\]/g, (gap) => gap.replace(/\\\|/g, "|"));
export const LessonTable = Table.extend({
  renderMarkdown(node, h, context) {
    const grid: JSONContent[][] = [],
      spans: CellSpan[] = [];
    for (const [r, row] of (node.content ?? []).entries()) {
      grid[r] ??= [];
      let c = 0;
      for (const cell of row.content ?? []) {
        while (grid[r][c]) c++;
        const height = Math.max(
            1,
            Math.min(100, Number(cell.attrs?.rowspan ?? 1)),
          ),
          width = Math.max(1, Math.min(40, Number(cell.attrs?.colspan ?? 1)));
        if (height > 1 || width > 1) spans.push([r, c, height, width]);
        for (let y = r; y < r + height; y++)
          for (let x = c; x < c + width; x++) {
            grid[y] ??= [];
            grid[y][x] =
              y === r && x === c
                ? { ...cell, attrs: { ...cell.attrs, rowspan: 1, colspan: 1 } }
                : {
                    type: r === 0 ? "tableHeader" : "tableCell",
                    content: [{ type: "paragraph" }],
                  };
          }
        c += width;
      }
    }
    if (!spans.length)
      return restoreGapPipes(base.renderMarkdown!.call(this, node, h, context));
    const expanded = {
      ...node,
      content: grid.map((content, r) => ({
        type: "tableRow",
        content: content.map((cell) =>
          r === 0 ? { ...cell, type: "tableHeader" } : cell,
        ),
      })),
    };
    return `${TABLE_SPAN_PREFIX}${JSON.stringify(spans)} -->\n${restoreGapPipes(base.renderMarkdown!.call(this, expanded, h, context)).trim()}`;
  },
  parseMarkdown(token, h) {
    const table = base.parseMarkdown!.call(this, token, h) as JSONContent;
    const source = typeof token.emalSpans === "string" ? token.emalSpans : "";
    const rows = table.content ?? [],
      cols = Math.max(0, ...rows.map((row) => row.content?.length ?? 0));
    const spans = readTableSpans(source, rows.length, cols);
    if (!spans) return table;
    const covered = new Set<string>();
    for (const [r, c, height, width] of spans) {
      const cell = rows[r].content![c];
      cell.attrs = { ...cell.attrs, rowspan: height, colspan: width };
      for (let y = r; y < r + height; y++)
        for (let x = c; x < c + width; x++)
          if (y !== r || x !== c) covered.add(`${y}:${x}`);
    }
    rows.forEach((row, r) => {
      row.content = row.content?.filter((_, c) => !covered.has(`${r}:${c}`));
    });
    return table;
  },
  markdownTokenizer: {
    name: "table",
    level: "block",
    start(src) {
      const index = src.indexOf(TABLE_SPAN_PREFIX);
      const native = base.markdownTokenizer!.start;
      return index >= 0
        ? index
        : typeof native === "function"
          ? native(src)
          : typeof native === "string"
            ? src.indexOf(native)
            : -1;
    },
    tokenize(src, tokens, helper) {
      if (!src.startsWith(TABLE_SPAN_PREFIX)) {
        const native = base.markdownTokenizer!.tokenize(src, tokens, helper);
        if (native) return native;
        const candidate = src.split(/\n\s*\n/, 1)[0],
          lines = candidate.split("\n");
        if (
          lines.length < 2 ||
          !/^[ \t|:]*-[ \t|:-]*$/.test(lines[1]) ||
          !lines[1].includes("|")
        )
          return undefined;
        const escaped = candidate.replace(/\[\[[^\n]*?\]\]/g, (gap) =>
          gap.replace(/(?<!\\)\|/g, "\\|"),
        );
        if (escaped === candidate) return undefined;
        const table = helper.blockTokens(escaped)[0];
        if (table?.type !== "table" || !table.raw) return undefined;
        return {
          ...table,
          raw: src
            .split("\n")
            .slice(0, table.raw.split("\n").length)
            .join("\n"),
        };
      }
      const end = src.indexOf("\n");
      if (end < 0 || end > 20040) return undefined;
      const marker = src.slice(0, end),
        rest = src.slice(end + 1).trimStart();
      const token = helper.blockTokens(rest)[0];
      if (token?.type !== "table") return undefined;
      return {
        ...token,
        raw: src.slice(0, src.length - rest.length) + token.raw,
        emalSpans: marker,
      };
    },
  },
});
