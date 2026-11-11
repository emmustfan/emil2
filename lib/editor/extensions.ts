import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { LessonTable } from "./table";
import { imageId } from "../content/image-reference";
const LessonImageNode = Image.extend({
  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (element) =>
          imageId(element.getAttribute("src") ?? "") ? {} : false,
      },
    ];
  },
  parseMarkdown(token, helpers) {
    const src = String(token.href ?? "");
    return imageId(src)
      ? helpers.createNode("image", {
          src,
          alt: token.text,
          title: token.title,
        })
      : helpers.createTextNode(String(token.text || "Изображение недоступно"));
  },
  renderHTML({ node, HTMLAttributes }) {
    return imageId(String(node.attrs.src ?? ""))
      ? ["img", HTMLAttributes]
      : ["span", {}, String(node.attrs.alt || "Изображение недоступно")];
  },
});
export const LessonGapNode = Node.create({
  name: "lessonGap",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-lesson-gap") ?? "",
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-lesson-gap]",
        getAttrs: (el) =>
          /^\[\[[^\n]+\]\]$/.test(el.getAttribute("data-lesson-gap") ?? "")
            ? {}
            : false,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const source = String(node.attrs.source);
    const label = source.slice(2, -2).replace(/^=/, "").split("|")[0];
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-lesson-gap": source,
        class: "rich-gap-token",
        title: "Выберите пропуск и нажмите «Пропуск», чтобы изменить ответы",
      }),
      `${label} ▾`,
    ];
  },
  renderText({ node }) {
    return String(node.attrs.source);
  },
  markdownTokenName: "lessonGap",
  parseMarkdown(token, helpers) {
    return helpers.createNode("lessonGap", {
      source: String(token.raw ?? "").replace(/\\\|/g, "|"),
    });
  },
  renderMarkdown(node) {
    return String(node.attrs?.source ?? "");
  },
  markdownTokenizer: {
    name: "lessonGap",
    level: "inline",
    start: (src) => src.indexOf("[["),
    tokenize(src) {
      const match = src.match(/^\[\[[^\n]*?\]\]/);
      return match ? { type: "lessonGap", raw: match[0] } : undefined;
    },
  },
});
export function lessonEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
    }),
    LessonImageNode.configure({ inline: false, allowBase64: false }),
    TableKit.configure({ table: false }),
    LessonTable,
    LessonGapNode,
    Markdown,
  ];
}
