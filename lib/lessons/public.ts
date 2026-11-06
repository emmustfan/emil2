import { createHash } from "node:crypto";
import { parseTopic } from "../content/parse";
import type { LessonBlock, Option } from "./types";
export function shuffledOptions(
  values: string[],
  actorKey: string,
  gapId: string,
): Option[] {
  // Hashes contain option text, never its correctness or original index.
  return values
    .map((text) => ({
      id: createHash("sha256")
        .update(`${actorKey}\0${gapId}\0${text}`)
        .digest("hex"),
      text,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function publicBlocks(
  markdown: string,
  gapIds: Map<string, string>,
  previewCount?: number,
): LessonBlock[] {
  const parsed = parseTopic(markdown);
  if (parsed.errors.length)
    throw new Error("Published lesson contains invalid Markdown");
  const blocks =
    previewCount === undefined
      ? parsed.blocks
      : parsed.blocks.slice(0, previewCount);
  return blocks.map((block) => {
    let md = "",
      cursor = block.start;
    for (const gap of parsed.gaps
      .filter((g) => g.start >= block.start && g.end <= block.end)
      .sort((a, b) => a.start - b.start)) {
      const id = gapIds.get(gap.gapKey);
      if (previewCount === undefined && !id)
        throw new Error("Published gap is missing");
      md +=
        markdown.slice(cursor, gap.start) +
        (previewCount === undefined ? `[____](#lesson-gap-${id})` : "____");
      cursor = gap.end;
    }
    md += markdown.slice(cursor, block.end);
    return { blockKey: block.blockKey, markdown: md };
  });
}
export function completedLesson(
  answered: number,
  total: number,
  bestScore: number | null,
  threshold: number,
) {
  return answered === total && bestScore !== null && bestScore >= threshold;
}
export function optionsFromJSON(value: unknown): Option[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (o): o is Option =>
        typeof o === "object" &&
        o !== null &&
        typeof o.id === "string" &&
        typeof o.text === "string",
    )
    .map((o) => ({ id: o.id, text: o.text }));
}
