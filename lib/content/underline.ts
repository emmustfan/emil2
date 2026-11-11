import type { Root, RootContent } from "mdast";
// Recognize only bare <u> delimiters. Raw HTML and its attributes stay disabled.
export function remarkUnderline() {
  return (root: Root) => {
    function walk(node: { children?: RootContent[] }) {
      const children = node.children;
      if (!children) return;
      for (const child of children) walk(child as { children?: RootContent[] });
      for (let i = 0; i < children.length; i++) {
        const start = children[i];
        if (start.type === "html" && /^<br\s*\/?>$/i.test(start.value)) {
          children[i] = { type: "break" };
          continue;
        }
        if (start.type !== "html" || !/^<u>$/i.test(start.value)) continue;
        let depth = 1,
          end = i + 1;
        for (; end < children.length; end++) {
          const next = children[end];
          if (next.type !== "html") continue;
          if (/^<u>$/i.test(next.value)) depth++;
          if (/^<\/u>$/i.test(next.value) && --depth === 0) break;
        }
        if (depth !== 0) continue;
        const underlined = {
          type: "emphasis" as const,
          data: { hName: "u" },
          children: children.slice(i + 1, end) as never[],
        };
        walk(underlined);
        children.splice(i, end - i + 1, underlined);
      }
    }
    walk(root);
  };
}
