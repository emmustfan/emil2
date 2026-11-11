import type { Root, Table } from "mdast";

export type CellSpan = [number, number, number, number];
export const TABLE_SPAN_PREFIX = "<!-- emal-table:v1 ";
export function readTableSpans(source: string, rows: number, cols: number) {
  if (rows < 1 || rows > 100 || cols < 1 || cols > 40) return null;
  const match = source.trim().match(/^<!-- emal-table:v1 (.{1,20000}) -->$/);
  if (!match) return null;
  try {
    const spans: unknown = JSON.parse(match[1]);
    if (!Array.isArray(spans) || spans.length > rows * cols) return null;
    const occupied = new Set<string>();
    for (const span of spans) {
      if (
        !Array.isArray(span) ||
        span.length !== 4 ||
        !span.every(Number.isInteger)
      )
        return null;
      const [r, c, height, width] = span as CellSpan;
      if (
        r < 0 ||
        c < 0 ||
        height < 1 ||
        width < 1 ||
        r + height > rows ||
        c + width > cols
      )
        return null;
      for (let y = r; y < r + height; y++)
        for (let x = c; x < c + width; x++) {
          const key = `${y}:${x}`;
          if (occupied.has(key)) return null;
          occupied.add(key);
        }
    }
    return spans as CellSpan[];
  } catch {
    return null;
  }
}
export function remarkTableSpans() {
  return (root: Root) => {
    for (let i = 0; i < root.children.length - 1; i++) {
      const marker = root.children[i],
        table = root.children[i + 1];
      if (marker.type !== "html" || table.type !== "table") continue;
      const rows = table.children;
      const spans = readTableSpans(marker.value, ...tableDimensions(table));
      if (!spans) continue;
      const covered = new Set<string>();
      for (const [r, c, height, width] of spans) {
        const cell = rows[r].children[c];
        cell.data = {
          ...cell.data,
          hProperties: { rowSpan: height, colSpan: width },
        };
        for (let y = r; y < r + height; y++)
          for (let x = c; x < c + width; x++)
            if (y !== r || x !== c) covered.add(`${y}:${x}`);
      }
      rows.forEach((row, r) => {
        row.children = row.children.filter((_, c) => !covered.has(`${r}:${c}`));
      });
      // One row group lets a header cell span into the following row correctly.
      table.data = {
        ...table.data,
        hProperties: { ...table.data?.hProperties, dataSpanned: "true" },
      };
      root.children.splice(i, 1);
    }
  };
}
type HtmlNode = {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
};
export function rehypeTableRowGroups() {
  return (root: HtmlNode) => {
    function walk(node: HtmlNode) {
      if (node.tagName === "table" && node.properties?.dataSpanned === "true") {
        const rows = (node.children ?? []).flatMap((child) =>
          ["thead", "tbody"].includes(child.tagName ?? "")
            ? (child.children ?? [])
            : [child],
        );
        node.children = [
          {
            type: "element",
            tagName: "tbody",
            properties: {},
            children: rows,
          } as HtmlNode,
        ];
        delete node.properties.dataSpanned;
      }
      node.children?.forEach(walk);
    }
    walk(root);
  };
}
export function tableDimensions(table: Table) {
  return [
    table.children.length,
    table.children.length
      ? Math.min(...table.children.map((row) => row.children.length))
      : 0,
  ] as const;
}
