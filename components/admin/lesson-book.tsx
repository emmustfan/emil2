"use client";
import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { TopicEditor, type TopicEditorHandle } from "./topic-editor";
import { requestContent, fieldClass } from "./helpers";
import { headingSlug } from "@/lib/content/slug";
import type { ParsedTopic } from "@/lib/content/parse";
import type { SectionDTO, TopicDTO, ContentStatus } from "@/lib/content/types";
import { contentRu } from "@/lib/i18n/ru";
export type BookTopic = {
  id: string;
  title: string;
  sectionId: string | null;
  status: ContentStatus;
  isFree: boolean;
  order: number;
};
type Bundle = { topic: TopicDTO; parsed: ParsedTopic };
export function LessonBook({
  subject,
  initial,
  initialSections,
  initialTopics,
  settings,
  upload,
  startCreating = false,
}: {
  subject: { id: string; title: string };
  initial: Bundle | null;
  initialSections: SectionDTO[];
  initialTopics: BookTopic[];
  settings: {
    autosaveMs: number;
    minQuestions: number;
    maxQuestions: number;
    imageMaxBytes: number;
  };
  upload: ReactNode;
  startCreating?: boolean;
}) {
  const [current, setCurrent] = useState(initial),
    [sections, setSections] = useState(initialSections),
    [topics, setTopics] = useState(initialTopics),
    [mode, setMode] = useState<"lesson" | "section" | null>(
      startCreating || !initial ? "lesson" : null,
    ),
    [title, setTitle] = useState(""),
    [slug, setSlug] = useState(""),
    [parent, setParent] = useState(
      initial?.topic.sectionId ?? initialSections[0]?.id ?? "",
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const editor = useRef<TopicEditorHandle>(null),
    inFlight = useRef(false);
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      if (editor.current) await editor.current.withSavedDraft(action);
      else await action();
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие.",
      );
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  function select(bundle: Bundle) {
    setCurrent(bundle);
    setParent(bundle.topic.sectionId ?? "");
    setMode(null);
    window.history.replaceState(null, "", `/admin/topics/${bundle.topic.id}`);
  }
  async function open(id: string) {
    if (current?.topic.id === id || pending) return;
    await run(async () => {
      const topic = await requestContent<TopicDTO>(`topics/${id}`, "GET");
      const parsed = await requestContent<ParsedTopic>("preview", "POST", {
        contentMd: topic.contentMd,
      });
      select({ topic, parsed });
    });
  }
  const updated = useCallback((topic: TopicDTO) => {
    setTopics((items) =>
      items.map((item) =>
        item.id === topic.id
          ? {
              id: topic.id,
              title: topic.title,
              sectionId: topic.sectionId,
              status: topic.status,
              isFree: topic.isFree,
              order: topic.order,
            }
          : item,
      ),
    );
    setCurrent((previous) =>
      previous?.topic.id === topic.id ? { ...previous, topic } : previous,
    );
  }, []);
  const tree = (
    <aside className="editor-tree book-tree" aria-label="Уроки предмета">
      <div className="book-subject">
        <small>Предмет</small>
        <Link href={`/admin/subjects/${subject.id}`}>{subject.title}</Link>
      </div>
      <nav aria-label="Разделы и уроки">
        {[
          ...sections.map((section) => ({
            id: section.id,
            title: section.title,
          })),
          ...(topics.some((topic) => !topic.sectionId)
            ? [{ id: "", title: "Без раздела" }]
            : []),
        ].map((section) => (
          <details className="book-section" key={section.id} open>
            <summary>{section.title}</summary>
            <div>
              {topics
                .filter((topic) => (topic.sectionId ?? "") === section.id)
                .map((topic) => (
                  <a
                    key={topic.id}
                    href={`/admin/topics/${topic.id}`}
                    aria-current={
                      current?.topic.id === topic.id ? "page" : undefined
                    }
                    onClick={(event) => {
                      if (
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.shiftKey &&
                        !event.altKey
                      ) {
                        event.preventDefault();
                        void open(topic.id);
                      }
                    }}
                    aria-disabled={pending}
                  >
                    <span>{topic.title}</span>
                    <small>
                      <i
                        className={`book-status is-${topic.status.toLowerCase()}`}
                      />
                      {contentRu.statuses[topic.status]}
                      {topic.isFree ? " · бесплатно" : ""}
                    </small>
                  </a>
                ))}
              {!topics.some(
                (topic) => (topic.sectionId ?? "") === section.id,
              ) && <p className="book-tree-empty">Уроков пока нет</p>}
              <button
                type="button"
                disabled={pending}
                className="book-tree-add"
                onClick={() => {
                  setParent(section.id);
                  setMode("lesson");
                  setTitle("");
                  setSlug("");
                }}
              >
                + Урок в разделе
              </button>
            </div>
          </details>
        ))}
      </nav>
      <div className="book-create-actions">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setMode("section");
            setTitle("");
          }}
        >
          + Новый раздел
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setMode("lesson");
            setTitle("");
            setSlug("");
          }}
        >
          + Новый урок
        </button>
      </div>
      {mode && (
        <form
          aria-label={mode === "section" ? "Новый раздел" : "Новый урок"}
          className="book-create-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await run(async () => {
              if (mode === "section") {
                const section = await requestContent<SectionDTO>(
                  "sections",
                  "POST",
                  { subjectId: subject.id, title, order: sections.length },
                );
                setSections((items) => [...items, section]);
                setParent(section.id);
                setMode("lesson");
                setTitle("");
                setSlug("");
              } else {
                const topic = await requestContent<TopicDTO>("topics", "POST", {
                  subjectId: subject.id,
                  title,
                  slug,
                  sectionId: parent || null,
                  order: topics.filter((t) => (t.sectionId ?? "") === parent)
                    .length,
                  isFree: false,
                  contentMd: "",
                  gapExercises: {},
                  readingMinutes: null,
                  authorName: null,
                  reviewerName: null,
                  referencesMd: null,
                  reviewed: false,
                });
                setTopics((items) => [
                  ...items,
                  {
                    id: topic.id,
                    title: topic.title,
                    sectionId: topic.sectionId,
                    status: topic.status,
                    isFree: topic.isFree,
                    order: topic.order,
                  },
                ]);
                select({
                  topic,
                  parsed: { blocks: [], gaps: [], errors: [], images: [] },
                });
              }
            });
            if (ok && mode === "lesson") {
              setTitle("");
              setSlug("");
            }
          }}
        >
          <h3>{mode === "section" ? "Новый раздел" : "Новый урок"}</h3>
          <fieldset disabled={pending}>
            <label>
              {mode === "section" ? "Название раздела" : "Название урока"}
              <input
                className={fieldClass}
                required
                maxLength={200}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (mode === "lesson") setSlug(headingSlug(e.target.value));
                }}
              />
            </label>
            {mode === "lesson" && (
              <>
                <label>
                  Раздел для урока
                  <select
                    className={fieldClass}
                    value={parent}
                    onChange={(e) => setParent(e.target.value)}
                  >
                    <option value="">Без раздела</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Адрес урока
                  <input
                    className={fieldClass}
                    required
                    maxLength={100}
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </label>
              </>
            )}
            <button className="lesson-primary" type="submit">
              {pending
                ? "Сохранение…"
                : mode === "section"
                  ? "Добавить раздел"
                  : "Создать урок"}
            </button>
            {current && (
              <button type="button" onClick={() => setMode(null)}>
                Отмена
              </button>
            )}
          </fieldset>
        </form>
      )}
    </aside>
  );
  return (
    <main className="lesson-book">
      <div className="book-heading">
        <div>
          <p className="book-breadcrumb">
            Редактор урока <span>/</span> {subject.title}
            {current?.topic.sectionId && (
              <>
                {" "}
                <span>/</span>{" "}
                {sections.find((s) => s.id === current.topic.sectionId)?.title}
              </>
            )}
          </p>
          <h1>{current?.topic.title ?? "Новый урок"}</h1>
        </div>
        <details className="inline-import">
          <summary>Импорт PDF/DOCX</summary>
          <div className="inline-import-body">{upload}</div>
        </details>
      </div>
      {error && (
        <p role="alert" className="book-error">
          {error}
        </p>
      )}
      {pending && (
        <p role="status" className="book-saving">
          Сохраняем черновик и обновляем книгу…
        </p>
      )}
      {current ? (
        <TopicEditor
          ref={editor}
          key={current.topic.id}
          initial={current.topic}
          initialParsed={current.parsed}
          sections={sections}
          tree={tree}
          onTopicChange={updated}
          {...settings}
        />
      ) : (
        <div className="book-empty-layout">
          {tree}
          <section className="emal-panel">
            <h2>Создайте первый урок</h2>
            <p>
              Добавьте раздел и урок в дереве слева. Здесь откроются текст,
              предпросмотр и тест.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
