import type { ParsedTopic } from "./parse";
export function previewMarkdown(md: string, parsed: ParsedTopic) {
  let text = "",
    cursor = 0;
  for (const gap of [...parsed.gaps].sort((a, b) => a.start - b.start)) {
    text += md.slice(cursor, gap.start) + `[____](#preview-gap-${gap.order})`;
    cursor = gap.end;
  }
  return text + md.slice(cursor);
}
