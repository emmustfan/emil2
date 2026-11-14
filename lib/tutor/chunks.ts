import { parseTopic, type ParsedBlock } from "../content/parse";
import { redactPersonalData } from "./privacy";
export type Chunk = {
  blockKey: string;
  heading: string | null;
  text: string;
  tokenCount: number;
};
export function publishedBlocks(
  markdown: string,
  answers: Map<string, string>,
) {
  const parsed = parseTopic(markdown);
  if (parsed.errors.length) throw new Error("Invalid published Markdown");
  let unfolded = markdown;
  for (const gap of [...parsed.gaps].reverse()) {
    const answer = (answers.get(gap.gapKey) ?? gap.answer).replace(
      /[\\`*_{}[\]()#+.!|>~-]/g,
      "\\$&",
    );
    unfolded = unfolded.slice(0, gap.start) + answer + unfolded.slice(gap.end);
  }
  const clean = parseTopic(unfolded);
  return parsed.blocks.map((block, i) => ({
    ...block,
    heading: block.heading ? redactPersonalData(block.heading) : null,
    text: redactPersonalData(clean.blocks[i]?.text ?? ""),
  }));
}
export function chunkBlocks(
  blocks: ParsedBlock[],
  targetTokens: number,
  maxTokens: number,
): Chunk[] {
  if (
    !Number.isInteger(targetTokens) ||
    targetTokens < 1 ||
    !Number.isInteger(maxTokens) ||
    maxTokens < targetTokens
  )
    throw new Error("Invalid chunk settings");
  const chunks: Chunk[] = [],
    maxChars = maxTokens * 4;
  let current: Chunk | null = null;
  const flush = () => {
    if (current?.text.trim())
      chunks.push({
        ...current,
        tokenCount: Math.ceil(current.text.length / 4),
      });
    current = null;
  };
  for (const block of blocks) {
    if (!block.text.trim()) continue;
    if (
      current &&
      (current.heading !== block.heading ||
        current.text.length >= targetTokens * 4)
    )
      flush();
    const parts: string[] = [];
    let part = "";
    for (const word of block.text.split(/\s+/)) {
      // Split even a single long token rather than exceeding the embedding limit.
      for (let i = 0; i < word.length; i += maxChars) {
        const piece = word.slice(i, i + maxChars);
        if (part && part.length + 1 + piece.length > maxChars) {
          parts.push(part);
          part = "";
        }
        part += (part ? " " : "") + piece;
      }
    }
    if (part) parts.push(part);
    for (const text of parts) {
      if (current && current.text.length + text.length + 2 > maxChars) flush();
      if (!current)
        current = {
          blockKey: block.blockKey,
          heading: block.heading,
          text,
          tokenCount: 0,
        };
      else current.text += "\n\n" + text;
    }
  }
  flush();
  return chunks;
}
