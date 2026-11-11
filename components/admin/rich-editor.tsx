"use client";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  Bold,
  Italic,
  Underline,
  Heading2,
  Quote,
  List,
  Undo2,
  Redo2,
  ListPlus,
  Table2,
  ImagePlus,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import { moveBlock, removeBlock, selectedBlock } from "@/lib/editor/blocks";
import { lessonEditorExtensions } from "@/lib/editor/extensions";
import {
  createGapMarkdown,
  gapDefinition,
  type Definition,
  type GapExercise,
  type GapExercises,
} from "@/lib/exercises";
import type { ParsedTopic } from "@/lib/content/parse";
import {
  DefinitionEditor,
  cleanDefinition,
} from "@/components/exercises/definition-editor";
export type RichEditorHandle = { insertMarkdown: (markdown: string) => void };
export function RichEditor({
  value,
  disabled,
  onChange,
  parsed,
  exercises,
  onGapChange,
  onImage,
  ref,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  parsed: ParsedTopic;
  exercises: GapExercises;
  onGapChange: (
    markdown: string,
    order: number,
    config: GapExercise,
  ) => Promise<void>;
  onImage?: () => void;
  ref?: Ref<RichEditorHandle>;
}) {
  const extensions = useMemo(() => lessonEditorExtensions(), []);
  const [initialContent] = useState(value);
  const external = useRef(value);
  const last = useRef(value),
    dialog = useRef<HTMLDialogElement>(null);
  const [gapForm, setGapForm] = useState<{
      from: number;
      to: number;
      definition: Definition;
    } | null>(null),
    [definition, setDefinition] = useState<Definition | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const editor = useEditor({
    extensions,
    content: initialContent,
    contentType: "markdown",
    immediatelyRender: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Текст методички",
        "aria-multiline": "true",
        class: "rich-document lesson-markdown",
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      last.current = md;
      onChange(md);
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            heading: e.isActive("heading"),
            quote: e.isActive("blockquote"),
            list: e.isActive("bulletList"),
            canGap: !e.state.selection.empty || e.isActive("lessonGap"),
            undo: e.can().undo(),
            redo: e.can().redo(),
            table: e.isActive("table"),
            merge: e.can().mergeCells(),
            split: e.can().splitCell(),
            block: selectedBlock(e)?.node.type.name,
            blockUp: (selectedBlock(e)?.index ?? 0) > 0,
            blockDown:
              (selectedBlock(e)?.index ?? 0) < e.state.doc.childCount - 1,
          }
        : null,
  });
  useEffect(() => {
    if (!editor || value === external.current) return;
    external.current = value;
    if (value !== last.current) {
      last.current = value;
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
      last.current = value;
    }
  }, [value, editor]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [disabled, editor]);
  useEffect(() => {
    if (gapForm && !dialog.current?.open) dialog.current?.showModal();
  }, [gapForm]);
  useImperativeHandle(
    ref,
    () => ({
      insertMarkdown(markdown) {
        editor?.commands.insertContent(markdown, { contentType: "markdown" });
        editor?.commands.focus();
      },
    }),
    [editor],
  );
  function openGap() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const node = editor.state.doc.nodeAt(from);
    let order = 0;
    editor.state.doc.descendants((item, pos) => {
      if (pos < from && item.type.name === "lessonGap") order++;
    });
    let d: Definition;
    if (node?.type.name === "lessonGap" && parsed.gaps[order]) {
      const gap = parsed.gaps[order];
      d = gapDefinition(gap, exercises[gap.gapKey]);
    } else {
      const text = editor.state.doc.textBetween(from, to, " ").trim();
      if (!text) {
        setError("Сначала выделите слово или фразу в тексте.");
        return;
      }
      d = {
        answerType: "SINGLE_CHOICE",
        options: [
          { id: "a", text },
          { id: "b", text: "" },
        ],
        correctOptionIds: ["a"],
        acceptedAnswers: [],
        explanation: "",
      };
    }
    setError("");
    setDefinition(d);
    setGapForm({ from, to, definition: d });
  }
  const actions = [
    {
      name: "Жирный",
      Icon: Bold,
      active: state?.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      name: "Курсив",
      Icon: Italic,
      active: state?.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      name: "Подчёркнутый",
      Icon: Underline,
      active: state?.underline,
      run: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      name: "Заголовок",
      Icon: Heading2,
      active: state?.heading,
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      name: "Цитата",
      Icon: Quote,
      active: state?.quote,
      run: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "Список",
      Icon: List,
      active: state?.list,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
  ];
  return (
    <div className="rich-editor">
      <div
        className="rich-toolbar"
        role="toolbar"
        aria-label="Оформление выделенного текста"
      >
        {actions.map(({ name, Icon, active, run }) => (
          <button
            key={name}
            type="button"
            title={name}
            aria-label={name}
            aria-pressed={!!active}
            disabled={disabled || !editor}
            onMouseDown={(e) => e.preventDefault()}
            onClick={run}
          >
            <Icon size={18} />
          </button>
        ))}
        <span className="rich-toolbar-divider" />
        {onImage && (
          <button
            type="button"
            aria-label="Вставить изображение"
            title="Вставить изображение в текст"
            disabled={disabled || !editor}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onImage}
          >
            <ImagePlus size={18} />
          </button>
        )}
        <button
          type="button"
          title="Вставить таблицу"
          aria-label="Вставить таблицу"
          disabled={disabled || !editor}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
              .run()
          }
        >
          <Table2 size={18} />
        </button>
        <button
          type="button"
          title="Отменить"
          aria-label="Отменить действие"
          disabled={disabled || !state?.undo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          title="Повторить"
          aria-label="Повторить действие"
          disabled={disabled || !state?.redo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 size={18} />
        </button>
        <button
          type="button"
          className="rich-gap-button"
          disabled={disabled || !state?.canGap}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openGap}
        >
          <ListPlus size={17} />
          Пропуск
        </button>
      </div>
      {state?.table && (
        <div
          className="rich-context-tools"
          role="toolbar"
          aria-label="Управление таблицей"
        >
          <strong>Таблица</strong>
          {[
            ["Строка выше", () => editor?.chain().focus().addRowBefore().run()],
            ["Строка ниже", () => editor?.chain().focus().addRowAfter().run()],
            [
              "Столбец слева",
              () => editor?.chain().focus().addColumnBefore().run(),
            ],
            [
              "Столбец справа",
              () => editor?.chain().focus().addColumnAfter().run(),
            ],
            ["Удалить строку", () => editor?.chain().focus().deleteRow().run()],
            [
              "Удалить столбец",
              () => editor?.chain().focus().deleteColumn().run(),
            ],
          ].map(([name, run]) => (
            <button
              key={name as string}
              type="button"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={run as () => void}
            >
              {name as string}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled || !state.merge}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().mergeCells().run()}
          >
            Объединить ячейки
          </button>
          <button
            type="button"
            disabled={disabled || !state.split}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().splitCell().run()}
          >
            Разделить ячейку
          </button>
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().deleteTable().run()}
          >
            Удалить таблицу
          </button>
          <small>
            Выделите соседние ячейки мышью или с Shift, затем объедините. Tab в
            последней ячейке добавляет строку.
          </small>
        </div>
      )}
      {editor && (
        <div
          className="rich-block-tools"
          role="toolbar"
          aria-label="Порядок блоков"
        >
          <span>
            {state?.block === "image"
              ? "Изображение"
              : state?.table
                ? "Таблица"
                : "Блок текста"}
          </span>
          <button
            type="button"
            title="Переместить блок выше"
            aria-label="Переместить блок выше"
            disabled={disabled || !state?.blockUp}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => moveBlock(editor, -1)}
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            title="Переместить блок ниже"
            aria-label="Переместить блок ниже"
            disabled={disabled || !state?.blockDown}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => moveBlock(editor, 1)}
          >
            <ArrowDown size={16} />
          </button>
          {state?.block === "image" && (
            <>
              <button
                type="button"
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const b = selectedBlock(editor);
                  if (b) {
                    editor.commands.insertContentAt(b.from + b.node.nodeSize, {
                      type: "paragraph",
                    });
                    editor.commands.setTextSelection(
                      b.from + b.node.nodeSize + 1,
                    );
                    editor.commands.focus();
                  }
                }}
              >
                Текст после изображения
              </button>
              <button
                type="button"
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const b = selectedBlock(editor);
                  if (b) {
                    editor.commands.insertContentAt(b.from, {
                      type: "paragraph",
                    });
                    editor.commands.setTextSelection(b.from + 1);
                    editor.commands.focus();
                  }
                }}
              >
                Текст перед изображением
              </button>
              <button
                type="button"
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => removeBlock(editor)}
              >
                <Trash2 size={16} />
                Удалить изображение
              </button>
            </>
          )}
        </div>
      )}
      <p className="rich-hint">
        Выделите текст и выберите оформление. Чтобы спрятать слово в задании,
        выделите его и нажмите «Пропуск». Картинка вставляется между абзацами.
        Выберите блок и используйте стрелки выше, чтобы изменить его место.
      </p>
      <EditorContent editor={editor} />
      {!editor && (
        <p className="p-5 text-sm" role="status">
          Загрузка редактора…
        </p>
      )}
      {error && !gapForm && (
        <p className="p-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <dialog
        ref={dialog}
        className="rich-gap-dialog"
        aria-label="Настройка пропуска"
        onCancel={(e) => {
          e.preventDefault();
          if (!pending) {
            dialog.current?.close();
            setGapForm(null);
          }
        }}
      >
        {gapForm && definition && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!editor) return;
              setPending(true);
              setError("");
              try {
                const result = createGapMarkdown(
                  "____",
                  cleanDefinition(definition),
                );
                const source = result.markdown.trim();
                const node = editor.schema.nodes.lessonGap.create(
                  { source },
                  null,
                  editor.state.selection.$from.marks(),
                );
                const transaction = editor.state.tr.replaceWith(
                  gapForm.from,
                  gapForm.to,
                  node,
                );
                let order = 0;
                transaction.doc.descendants((item, pos) => {
                  if (pos < gapForm.from && item.type.name === "lessonGap")
                    order++;
                });
                const next = editor.markdown!.serialize(
                  transaction.doc.toJSON(),
                );
                await onGapChange(next, order, result.config);
                last.current = next;
                editor.commands.setContent(transaction.doc.toJSON(), {
                  emitUpdate: false,
                });
                dialog.current?.close();
                setGapForm(null);
                editor
                  .chain()
                  .focus()
                  .setTextSelection(
                    Math.min(
                      gapForm.from + 1,
                      editor.state.doc.content.size - 1,
                    ),
                  )
                  .run();
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Не удалось сохранить пропуск.",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <h2>Настройка пропуска</h2>
              <button
                type="button"
                className="min-h-11 px-3"
                disabled={pending}
                onClick={() => {
                  dialog.current?.close();
                  setGapForm(null);
                  editor?.commands.focus();
                }}
                aria-label="Закрыть настройку пропуска"
              >
                ✕
              </button>
            </div>
            <p className="my-4 text-sm emal-muted">
              Слово останется на своём месте в тексте. Ученик увидит выбор
              вариантов или поле ответа.
            </p>
            <fieldset disabled={pending} className="space-y-4">
              <DefinitionEditor value={definition} onChange={setDefinition} />
              <button className="lesson-primary">
                {pending ? "Сохранение…" : "Сохранить пропуск"}
              </button>
            </fieldset>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-800">
                {error}
              </p>
            )}
          </form>
        )}
      </dialog>
    </div>
  );
}
