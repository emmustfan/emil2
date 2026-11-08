"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Root } from "mdast";
import type { ReactNode } from "react";
import type { LessonBlock } from "@/lib/lessons/types";
import { LessonImage } from "@/components/content/lesson-image";
function callouts() {
  return (tree: Root) => {
    for (const node of tree.children) {
      if (node.type !== "blockquote") continue;
      const p = node.children[0];
      const text = p?.type === "paragraph" ? p.children[0] : null;
      if (p?.type === "paragraph" && text?.type === "text") {
        const marker = text.value.match(/^\[!(important|remember)\]\s*/i);
        if (marker) {
          text.value = text.value.slice(marker[0].length);
          p.children.unshift({
            type: "strong",
            children: [
              {
                type: "text",
                value:
                  marker[1].toLowerCase() === "important"
                    ? "Важно: "
                    : "Запомните: ",
              },
            ],
          });
        }
      }
    }
  };
}
export function SafeMarkdown({
  markdown,
  gap,
}: {
  markdown: string;
  gap?: (id: string) => ReactNode;
}) {
  return (
    <div className="lesson-markdown">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, callouts]}
        rehypePlugins={[
          [
            rehypeSanitize,
            {
              ...defaultSchema,
            },
          ],
        ]}
        components={{
          img: ({ src, alt, title }) => (
            <LessonImage
              src={typeof src === "string" ? src : undefined}
              alt={alt}
              title={title}
            />
          ),
          a: ({ href, children }) => {
            const id = href?.match(/^#lesson-gap-([a-zA-Z0-9_-]+)$/)?.[1];
            if (id && gap) return gap(id);
            return (
              <a
                href={href}
                rel="noreferrer noopener"
                target={href?.startsWith("http") ? "_blank" : undefined}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
export function LessonMarkdown({
  blocks,
  gap,
  afterBlock,
}: {
  blocks: LessonBlock[];
  afterBlock?: (block: LessonBlock) => ReactNode;
  gap?: (id: string) => ReactNode;
}) {
  return (
    <>
      {blocks.map((b) => (
        <section
          key={b.blockKey}
          id={`b-${b.blockKey}`}
          className="lesson-block"
        >
          <SafeMarkdown markdown={b.markdown} gap={gap} />
          {afterBlock?.(b)}
        </section>
      ))}
    </>
  );
}
