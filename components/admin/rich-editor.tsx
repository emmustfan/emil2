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
  type Definition,
  type GapExercise,
} from "@/lib/exercises";
import {
  DefinitionEditor,
  cleanDefinition,
} from "@/components/exercises/definition-editor";
export type RichEditorHandle = { insertMarkdown: (markdown: string) => void };
export function RichEditor({
  value,
  disabled,
  onChange,
  onReadGap,
  onGapChange,
  onImage,
  ref,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onReadGap: (markdown: string, order: number) => Promise<Definition>;
  onGapChange: (
    markdown: string,
    order: number,
    config: GapExercise,
  ) => Promise<void>;
  onImage?: () => void;
  ref?: Ref<RichEditorHandle>;
}) {
  const activateGap = useRef<(position: number) => void>(() => {});
  const gapRequest = useRef(0);
  const extensions = useMemo(
    () => lessonEditorExtensions((position) => activateGap.current(position)),
    [],
  );
  const [initialContent] = useState(value);
  const external = useRef(value);
  const last = useRef(value),
    dialog = useRef<HTMLDialogElement>(null);
  const [gapForm, setGapForm] = useState<{
      from: number;
      to: number;
      snapshot: string;
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
    editor?.view.dom
      .querySelectorAll<HTMLButtonElement>("button.rich-gap-token")
      .forEach((button) => {
        button.disabled = disabled;
      });
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
  useEffect(() => {
    activateGap.current = (position) => {
      void openGap(position);
    };
  });
  useEffect(
    () => () => {
      gapRequest.current++;
    },
    [],
  );
  function closeGap() {
    if (pending) return;
    gapRequest.current++;
    dialog.current?.close();
    setGapForm(null);
    setDefinition(null);
    setError("");
  }
  async function openGap(position?: number) {
    if (!editor || disabled || pending) return;
    const { from, to } =
      position === undefined
        ? editor.state.selection
        : { from: position, to: position + 1 };
    const node = editor.state.doc.nodeAt(from);
    const existing = node?.type.name === "lessonGap";
    const text = existing
      ? ""
      : editor.state.doc.textBetween(from, to, " ").trim();
    if (!existing && !text) {
      setError("Сначала выделите слово или фразу в тексте.");
      return;
    }
    const snapshot = editor.getMarkdown(),
      request = ++gapRequest.current;
    setError("");
    setDefinition(null);
    setGapForm({ from, to, snapshot });
    if (!existing) {
      setDefinition({
        answerType: "SINGLE_CHOICE",
        options: [
          { id: "a", text },
          { id: "b", text: "" },
        ],
        correctOptionIds: ["a"],
        acceptedAnswers: [],
        explanation: "",
      });
      return;
    }
    let order = 0;
    editor.state.doc.descendants((item, pos) => {
      if (pos < from && item.type.name === "lessonGap") order++;
    });
    try {
      const next = await onReadGap(snapshot, order);
      if (request !== gapRequest.current || editor.isDestroyed) return;
      if (editor.getMarkdown() !== snapshot)
        throw new Error(
          "Текст изменился. Закройте окно и выберите пропуск снова.",
        );
      setDefinition(next);
    } catch (e) {
      if (request === gapRequest.current)
        setError(
          e instanceof Error
            ? e.message
            : "Не удалось открыть настройки пропуска.",
        );
    }
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
          onClick={() => {
            void openGap();
          }}
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
        выделите его и нажмите «Пропуск». Нажмите готовый пропуск, чтобы
        изменить варианты, правильные ответы и объяснение. Картинка вставляется
        между абзацами. Выберите блок и используйте стрелки выше, чтобы изменить
        его место.
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
          closeGap();
        }}
      >
        {gapForm && (
          <div className="flex items-center justify-between gap-4">
            <h2>Настройка пропуска</h2>
            <button
              type="button"
              className="min-h-11 px-3"
              disabled={pending}
              onClick={closeGap}
              aria-label="Закрыть настройку пропуска"
            >
              ✕
            </button>
          </div>
        )}
        {gapForm && !definition && !error && (
          <p className="my-4 text-sm" role="status">
            Загрузка вариантов…
          </p>
        )}
        {gapForm && definition && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!editor) return;
              setPending(true);
              setError("");
              try {
                if (editor.getMarkdown() !== gapForm.snapshot)
                  throw new Error(
                    "Текст изменился. Закройте окно и выберите пропуск снова.",
                  );
                const result = createGapMarkdown(
                  "____",
                  cleanDefinition(definition),
                );
                const source = result.markdown.trim();
                const node = editor.schema.nodes.lessonGap.create(
                  { source },
                  null,
                  editor.state.doc.nodeAt(gapForm.from)?.type.name ===
                    "lessonGap"
                    ? editor.state.doc.nodeAt(gapForm.from)!.marks
                    : editor.state.selection.$from.marks(),
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
                setDefinition(null);
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
          </form>
        )}
        {gapForm && error && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {error}
          </p>
        )}
      </dialog>
    </div>
  );
}
