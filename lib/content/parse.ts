import type { AnswerType } from "../exercises";
import { headingSlug } from "./slug";
import { createHash } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";
export type ParseError = {
  code: string;
  message: string;
  line: number;
  column: number;
};
export type ParsedBlock = {
  blockKey: string;
  kind: string;
  heading: string | null;
  markdown: string;
  text: string;
  line: number;
  start: number;
  end: number;
  rootIndex: number;
};
export type ParsedGap = {
  answerType: AnswerType;
  gapKey: string;
  blockKey: string;
  order: number;
  answer: string;
  distractors: string[];
  sentence: string;
  line: number;
  start: number;
  end: number;
};
export type ParsedTopic = {
  blocks: ParsedBlock[];
  gaps: ParsedGap[];
  errors: ParseError[];
};
type Node = {
  type: string;
  value?: string;
  children?: Node[];
  position?: {
    start: { offset?: number; line: number; column: number };
    end: { offset?: number };
  };
};
const parser = unified().use(remarkParse).use(remarkGfm);
export const MAX_MARKDOWN_CHARS = 100000;
export function normalizeSentence(text: string) {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
export function makeGapKey(sentence: string, answer: string) {
  return createHash("sha1")
    .update(`${normalizeSentence(sentence)}|${normalizeSentence(answer)}`)
    .digest("hex");
}

function escaped(text: string, index: number) {
  let n = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) n++;
  return n % 2 === 1;
}
// GFM must not interpret option separators as table-cell delimiters. UTF-16 offsets stay unchanged.
function maskPipes(md: string) {
  return md.replace(/\[\[[\s\S]*?\]\]/g, (value) => value.replace(/\|/g, "｜"));
}
function tree(md: string) {
  return parser.parse(maskPipes(md)) as Root;
}
function textOf(node: Node): string {
  if (node.type === "html" || node.type === "definition") return "";
  if (node.value !== undefined) return node.value;
  const separator = [
    "root",
    "list",
    "listItem",
    "blockquote",
    "table",
    "tableRow",
  ].includes(node.type)
    ? "\n"
    : "";
  return (node.children ?? []).map(textOf).join(separator);
}
export function parseTopic(md: string): ParsedTopic {
  const result: ParsedTopic = { blocks: [], gaps: [], errors: [] };
  const error = (code: string, message: string, index: number) => {
    if (result.errors.length >= 100) return;
    const before = md.slice(0, index);
    result.errors.push({
      code,
      message,
      line: before.split("\n").length,
      column: index - (before.lastIndexOf("\n") + 1) + 1,
    });
  };
  if (md.length > MAX_MARKDOWN_CHARS) {
    error(
      "too_large",
      "Материал слишком большой: разделите его на несколько тем.",
      0,
    );
    return result;
  }
  const root = tree(md);
  const ignored: [number, number][] = [];
  const handled: [number, number][] = [];
  const headingCounts = new Map<string, number>();
  let section = "vvedenie",
    heading: string | null = null,
    ordinal = 0;
  type Candidate = {
    answerType: AnswerType;
    start: number;
    end: number;
    answer: string;
    distractors: string[];
    blockKey: string;
    order: number;
  };
  const candidates: Candidate[] = [];
  for (const [rootIndex, rootNode] of root.children.entries()) {
    const node = rootNode as Node;
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? start;
    const raw = md.slice(start, end);
    if (node.type === "definition") continue;
    if (node.type === "heading") {
      heading = textOf(node).replace(/\[\[.*?\]\]/g, "____");
      const base = headingSlug(
        raw.replace(/^#{1,6}\s*/, "").replace(/\[\[.*?\]\]/g, "propusk"),
      );
      const occurrence = (headingCounts.get(base) ?? 0) + 1;
      headingCounts.set(base, occurrence);
      section = occurrence === 1 ? base : `${base}-${occurrence}`;
      ordinal = 0;
    } else ordinal++;
    const block: ParsedBlock = {
      blockKey: `${section}-${ordinal}`,
      kind: node.type,
      heading,
      markdown: raw,
      text: textOf(node),
      line: node.position?.start.line ?? 1,
      start,
      end,
      rootIndex,
    };
    result.blocks.push(block);
    function walk(current: Node) {
      const from = current.position?.start.offset ?? start,
        to = current.position?.end.offset ?? end;
      if (["code", "inlineCode", "html"].includes(current.type)) {
        ignored.push([from, to]);
        return;
      }
      if (current.type === "image" || current.type === "imageReference")
        error("image", "Изображения пока не поддерживаются в уроках.", from);
      if (current.type !== "text") {
        current.children?.forEach(walk);
        return;
      }
      const source = md.slice(from, to);
      let at = 0;
      while (at < source.length) {
        const local = source.indexOf("[[", at);
        if (local < 0) break;
        const index = from + local;
        at = local + 2;
        if (escaped(md, index)) continue;
        const close = source.indexOf("]]", local + 2);
        const nested = source.indexOf("[[", local + 2);
        if (close < 0) {
          error("unclosed", "Пропуск не закрыт символами ]].", index);
          handled.push([index, to]);
          break;
        }
        const finish = from + close + 2;
        handled.push([index, finish]);
        at = close + 2;
        if (nested >= 0 && nested < close) {
          error("nested", "Вложенные пропуски не допускаются.", from + nested);
          continue;
        }
        const inner = source.slice(local + 2, close).replace(/\\\|/g, "|");
        if (inner.includes("\n")) {
          error(
            "multiline",
            "Запишите варианты пропуска в одной строке.",
            index,
          );
          continue;
        }
        const shortText = inner.startsWith("=") && !inner.includes("|");
        const options = shortText
          ? [inner.slice(1).trim()]
          : inner.split("|").map((v) => v.trim());
        if (
          (!shortText && options.length < 2) ||
          options.length > 5 ||
          (shortText && inner.includes("|"))
        ) {
          error(
            "options_count",
            "Укажите правильный ответ и от 1 до 4 дистракторов.",
            index,
          );
          continue;
        }
        if (options.some((v) => !v)) {
          error(
            "empty_option",
            "Варианты ответа не могут быть пустыми.",
            index,
          );
          continue;
        }
        if (new Set(options.map(normalizeSentence)).size !== options.length) {
          error(
            "duplicate_option",
            "Варианты ответа не должны повторяться.",
            index,
          );
          continue;
        }
        candidates.push({
          answerType: shortText ? "SHORT_TEXT" : "SINGLE_CHOICE",
          start: index,
          end: finish,
          answer: options[0],
          distractors: options.slice(1),
          blockKey: block.blockKey,
          order: candidates.length,
        });
      }
    }
    walk(node);
  }
  const within = (at: number, ranges: [number, number][]) =>
    ranges.some(([a, b]) => at >= a && at < b);
  for (const match of md.matchAll(/\[\[|\]\]/g)) {
    const at = match.index!;
    if (escaped(md, at)) {
      if (match[0] === "[[") {
        const end = md.indexOf("]]", at + 2);
        if (end >= 0) ignored.push([at, end + 2]);
      }
      continue;
    }
    if (within(at, ignored) || within(at, handled)) continue;
    error(
      "broken_markup",
      match[0] === "[["
        ? "Пропуск пересекает границы Markdown-разметки или не закрыт."
        : "Закрывающие скобки без начала пропуска.",
      at,
    );
  }
  const keys = new Set<string>();
  for (const block of result.blocks) {
    const group = candidates.filter((g) => g.blockKey === block.blockKey);
    let marked = "",
      cursor = block.start;
    for (const gap of group) {
      marked += md.slice(cursor, gap.start) + `\uE000${gap.order}\uE001`;
      cursor = gap.end;
    }
    marked += md.slice(cursor, block.end);
    const plain = textOf(tree(marked) as unknown as Node);
    block.text = plain.replace(
      /\uE000(\d+)\uE001/g,
      (_, n: string) => candidates[Number(n)].answer,
    );
    for (const gap of group) {
      const position = plain.indexOf(`\uE000${gap.order}\uE001`);
      let left = 0,
        right = plain.length;
      for (const boundary of plain.matchAll(/[.!?](?=\s|$)|\n+/g)) {
        const end = boundary.index! + boundary[0].length;
        if (end <= position) left = end;
        else if (boundary.index! >= position) {
          right = end;
          break;
        }
      }
      const sentence = plain
        .slice(left, right)
        .replace(/\uE000\d+\uE001/g, "____")
        .trim();
      const gapKey = makeGapKey(sentence, gap.answer);
      if (keys.has(gapKey)) {
        error(
          "duplicate_gap",
          "Одинаковый пропуск повторяется в одинаковом контексте. Измените формулировку.",
          gap.start,
        );
        continue;
      }
      keys.add(gapKey);
      result.gaps.push({
        ...gap,
        gapKey,
        sentence,
        line: md.slice(0, gap.start).split("\n").length,
      });
    }
  }
  result.errors.sort((a, b) => a.line - b.line || a.column - b.column);
  return result;
}
export type MarkdownRoot = Root;
export type MarkdownContent = RootContent;
