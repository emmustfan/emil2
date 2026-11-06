"use client";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Root } from "mdast";
import type { ParsedTopic, ParsedGap } from "@/lib/content/parse";
import { previewMarkdown } from "@/lib/content/preview";
import { contentRu } from "@/lib/i18n/ru";
function PreviewGap({ gap }: { gap: ParsedGap }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const variants = [gap.answer, ...gap.distractors];
  const at = parseInt(gap.gapKey.slice(0, 8), 16) % variants.length;
  const options = [...variants.slice(at), ...variants.slice(0, at)];
  return (
    <span className="relative inline-block align-baseline">
      <button
        type="button"
        aria-expanded={open}
        aria-label={contentRu.chooseGap}
        onClick={() => setOpen(!open)}
        className={`min-h-11 rounded-lg border px-3 font-medium ${chosen === null ? "border-emerald-300 bg-emerald-50 text-emerald-900" : chosen === gap.answer ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-800"}`}
      >
        {chosen ?? "____"}
      </button>
      {open && (
        <span
          className="absolute top-full left-0 z-20 flex min-w-52 flex-col gap-1 rounded-xl border border-stone-200 bg-white p-2 shadow-lg"
          role="group"
          aria-label={contentRu.chooseGap}
        >
          {options.map((option) => (
            <button
              type="button"
              key={option}
              className="min-h-11 rounded-lg px-3 py-2 text-left text-sm text-stone-800 hover:bg-emerald-50"
              onClick={() => {
                setChosen(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </span>
      )}
      {chosen !== null && (
        <span
          className={`ml-2 text-xs ${chosen === gap.answer ? "text-emerald-800" : "text-red-800"}`}
          role="status"
        >
          {chosen === gap.answer
            ? `✓ ${contentRu.correctAnswer}`
            : `✕ ${contentRu.wrongAnswer} ${gap.answer}`}
        </span>
      )}
    </span>
  );
}
export function MarkdownPreview({
  markdown,
  parsed,
}: {
  markdown: string;
  parsed: ParsedTopic;
}) {
  const blocks = new Map(parsed.blocks.map((b) => [b.rootIndex, b]));
  function anchors() {
    return (tree: Root) => {
      tree.children.forEach((node, index) => {
        const block = blocks.get(index);
        if (block)
          node.data = {
            ...node.data,
            hProperties: { id: `b-${block.blockKey}` },
          };
        if (node.type === "blockquote") {
          const paragraph = node.children[0];
          const first =
            paragraph?.type === "paragraph" ? paragraph.children[0] : null;
          if (paragraph?.type === "paragraph" && first?.type === "text") {
            const marker = first.value.match(/^\[!(important|remember)\]\s*/i);
            if (marker) {
              first.value = first.value.slice(marker[0].length);
              paragraph.children.unshift({
                type: "strong",
                children: [
                  {
                    type: "text",
                    value:
                      marker[1].toLowerCase() === "important"
                        ? `${contentRu.important}: `
                        : `${contentRu.remember}: `,
                  },
                ],
              });
            }
          }
        }
      });
    };
  }
  if (!markdown.trim())
    return <p className="text-sm text-stone-500">{contentRu.previewEmpty}</p>;
  return (
    <div className="break-words text-base leading-8 text-stone-800 [&_h1]:mt-7 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-7 [&_h2]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:font-semibold [&_p]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:my-5 [&_blockquote]:border-l-4 [&_blockquote]:border-emerald-600 [&_blockquote]:bg-emerald-50 [&_blockquote]:px-5 [&_blockquote]:py-2 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-stone-100 [&_pre]:p-4 [&_table]:block [&_table]:overflow-auto [&_th]:border [&_th]:border-stone-300 [&_th]:p-3 [&_td]:border [&_td]:border-stone-300 [&_td]:p-3">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, anchors]}
        rehypePlugins={[
          [
            rehypeSanitize,
            {
              ...defaultSchema,
              clobberPrefix: "",
              tagNames: defaultSchema.tagNames?.filter((tag) => tag !== "img"),
            },
          ],
        ]}
        components={{
          a: ({ href, children, ...props }) => {
            const order = href?.match(/^#preview-gap-(\d+)$/)?.[1];
            const gap =
              order === undefined
                ? undefined
                : parsed.gaps.find((g) => g.order === Number(order));
            return gap ? (
              <PreviewGap
                key={gap.gapKey + gap.distractors.join("|")}
                gap={gap}
              />
            ) : (
              <a
                {...props}
                href={href}
                className="text-emerald-800 underline"
                target={href?.startsWith("http") ? "_blank" : undefined}
                rel="noreferrer noopener"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {previewMarkdown(markdown, parsed)}
      </Markdown>
    </div>
  );
}
