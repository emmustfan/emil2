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
export const LessonGapNode = Node.create<{
  onEdit?: (position: number) => void;
}>({
  name: "lessonGap",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { onEdit: undefined };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("button");
      dom.type = "button";
      dom.disabled = !editor.isEditable;
      dom.contentEditable = "false";
      dom.className = "rich-gap-token";
      dom.setAttribute("aria-haspopup", "dialog");
      const refresh = (source: string) => {
        const label = source.slice(2, -2).replace(/^=/, "").split("|")[0];
        dom.textContent = `${label} ▾`;
        dom.setAttribute("data-lesson-gap", source);
        dom.setAttribute("aria-label", `Изменить пропуск «${label}»`);
        dom.title = "Нажмите, чтобы изменить варианты и настройки пропуска";
      };
      refresh(String(node.attrs.source));
      const activate = (event: MouseEvent) => {
        event.preventDefault();
        const position = getPos();
        if (editor.isEditable && typeof position === "number")
          this.options.onEdit?.(position);
      };
      dom.addEventListener("click", activate);
      return {
        dom,
        update: (next) => {
          if (next.type !== node.type) return false;
          refresh(String(next.attrs.source));
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => dom.removeEventListener("click", activate),
      };
    };
  },
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
        title: "Нажмите, чтобы изменить варианты и настройки пропуска",
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
export function lessonEditorExtensions(onEditGap?: (position: number) => void) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
    }),
    LessonImageNode.configure({ inline: false, allowBase64: false }),
    TableKit.configure({ table: false }),
    LessonTable,
    LessonGapNode.configure({ onEdit: onEditGap }),
    Markdown,
  ];
}
