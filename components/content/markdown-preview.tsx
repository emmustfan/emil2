"use client";
import { AnswerPreview } from "@/components/exercises/preview";
import {
  gapDefinition,
  type GapExercise,
  type GapExercises,
} from "@/lib/exercises";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import { createElement, type HTMLAttributes } from "react";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Root } from "mdast";
import type { ParsedTopic, ParsedGap } from "@/lib/content/parse";
import { previewMarkdown } from "@/lib/content/preview";
import { contentRu } from "@/lib/i18n/ru";
import { LessonImage } from "./lesson-image";
function PreviewGap({ gap, config }: { gap: ParsedGap; config?: GapExercise }) {
  let definition;
  try {
    definition = gapDefinition(gap, config);
  } catch (e) {
    return (
      <span className="text-red-800">
        {e instanceof Error ? e.message : "Проверьте настройки пропуска"}
      </span>
    );
  }
  return (
    <div className="my-4 max-w-full">
      <AnswerPreview
        key={JSON.stringify(definition)}
        id={`markdown-${gap.gapKey}`}
        title={`Пропуск ${gap.order + 1}`}
        description={gap.sentence}
        definition={definition}
      />
    </div>
  );
}
export function MarkdownPreview({
  markdown,
  parsed,
  exercises = {},
}: {
  markdown: string;
  parsed: ParsedTopic;
  exercises?: GapExercises;
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
  function cards(id: unknown) {
    const key = typeof id === "string" ? id.replace(/^b-/, "") : null;
    return parsed.gaps
      .filter((g) => g.blockKey === key)
      .map((gap) => (
        <PreviewGap
          key={gap.gapKey + JSON.stringify(exercises[gap.gapKey])}
          gap={gap}
          config={exercises[gap.gapKey]}
        />
      ));
  }
  const blockComponents = Object.fromEntries(
    [
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "blockquote",
      "table",
      "pre",
    ].map((tag) => [
      tag,
      ({
        node,
        children,
        ...props
      }: HTMLAttributes<HTMLElement> & ExtraProps) => (
        <>
          {createElement(tag, props, children)}
          {cards(node?.properties.id)}
        </>
      ),
    ]),
  ) as Components;
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
            },
          ],
        ]}
        components={{
          ...blockComponents,
          img: ({ src, alt, title }) => (
            <LessonImage
              src={typeof src === "string" ? src : undefined}
              alt={alt}
              title={title}
            />
          ),
          a: ({ href, children, ...props }) => {
            const order = href?.match(/^#preview-gap-(\d+)$/)?.[1];
            const gap =
              order === undefined
                ? undefined
                : parsed.gaps.find((g) => g.order === Number(order));
            return gap ? (
              <a
                href={`#exercise-markdown-${gap.gapKey}`}
                className="rounded bg-emerald-50 px-2 text-emerald-800"
              >
                ____ {gap.order + 1}
              </a>
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
