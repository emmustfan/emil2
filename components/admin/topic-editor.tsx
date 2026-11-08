"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/content/markdown-preview";
import { contentRu as t } from "@/lib/i18n/ru";
import type { TopicDTO, SectionDTO, QuestionDTO } from "@/lib/content/types";
import type { TopicInput, QuestionInput } from "@/lib/content/validation";
import type { ParsedTopic } from "@/lib/content/parse";
import { requestContent, EditorRequestError, fieldClass } from "./helpers";
import { GapInsertForm } from "./gap-insert-form";
import type { GapExercise } from "@/lib/exercises";
import { GapExercisesEditor } from "./gap-exercises";
import { QuestionForm } from "./question-form";
import { ImageUpload } from "./image-upload";
import { LessonReview } from "./lesson-review";
import { lessonReadiness } from "@/lib/content/readiness";
import { lessonReviewPrompt } from "@/lib/content/review-prompt";
function fields(row: TopicDTO): TopicInput {
  return {
    title: row.title,
    slug: row.slug,
    sectionId: row.sectionId,
    order: row.order,
    isFree: row.isFree,
    contentMd: row.contentMd,
    gapExercises: row.gapExercises,
    readingMinutes: row.readingMinutes,
    authorName: row.authorName,
    reviewerName: row.reviewerName,
    referencesMd: row.referencesMd,
    reviewed: !row.needsExpertReview,
  };
}
export function TopicEditor({
  initial,
  initialParsed,
  sections,
  autosaveMs,
  minQuestions,
  maxQuestions,
  imageMaxBytes,
}: {
  initial: TopicDTO;
  initialParsed: ParsedTopic;
  sections: SectionDTO[];
  autosaveMs: number;
  minQuestions: number;
  maxQuestions: number;
  imageMaxBytes: number;
}) {
  const router = useRouter();
  const [imageIds, setImageIds] = useState(initial.imageIds ?? []);
  const [row, setRow] = useState(initial);
  const rowRef = useRef(initial);
  const [form, setForm] = useState(() => fields(initial));
  const formRef = useRef(form);
  const sequence = useRef(0);
  const dirty = useRef(false);
  const saving = useRef<Promise<TopicDTO> | null>(null);
  const [message, setMessage] = useState<string>(t.saved);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [parsed, setParsed] = useState(initialParsed);
  const [previewSource, setPreviewSource] = useState(initial.contentMd);
  const [publishIssues, setPublishIssues] = useState<ParsedTopic["errors"]>([]);
  const pre = useRef<HTMLPreElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState<QuestionDTO | undefined>();
  const [questionNonce, setQuestionNonce] = useState(0);
  function change<K extends keyof TopicInput>(key: K, value: TopicInput[K]) {
    const next = {
      ...formRef.current,
      [key]: value,
      ...(key !== "reviewed" ? { reviewed: false } : {}),
    };
    formRef.current = next;
    setForm(next);
    sequence.current++;
    dirty.current = true;
    setMessage(t.unsaved);
    setPublishIssues([]);
  }
  function accept(next: TopicDTO) {
    rowRef.current = next;
    setRow(next);
  }
  const saveDraft = useCallback(
    async function saveDraft(): Promise<TopicDTO> {
      if (saving.current) {
        await saving.current;
        if (dirty.current) return saveDraft();
        return rowRef.current;
      }
      if (!dirty.current) return rowRef.current;
      const at = sequence.current;
      const snapshot = { ...formRef.current };
      setMessage(t.saving);
      const operation = requestContent<TopicDTO>(
        `topics/${initial.id}`,
        "PATCH",
        { ...snapshot, revision: rowRef.current.editRevision },
      )
        .then((next) => {
          rowRef.current = next;
          setRow(next);
          if (sequence.current === at) {
            dirty.current = false;
            setMessage(t.saved);
            setError("");
          }
          return next;
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : t.error);
          setMessage(t.unsaved);
          if (
            e instanceof EditorRequestError &&
            e.status === 409 &&
            e.code === "stale"
          )
            setConflict(true);
          throw e;
        })
        .finally(() => {
          saving.current = null;
        });
      saving.current = operation;
      return operation;
    },
    [initial.id],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      if (dirty.current && !busyRef.current && !conflict)
        void saveDraft().catch(() => {});
    }, autosaveMs);
    return () => clearTimeout(timer);
  }, [form, autosaveMs, conflict, saveDraft]);
  useEffect(() => {
    const controller = new AbortController();
    const md = form.contentMd;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/content/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentMd: md }),
          signal: controller.signal,
        });
        if (response.ok) {
          const result = (await response.json()) as ParsedTopic;
          if (formRef.current.contentMd === md) {
            setParsed(result);
            setPreviewSource(md);
          }
        }
      } catch {
        /* Preserve the last preview during an aborted or failed request. */
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.contentMd]);
  async function foreground(action: (current: TopicDTO) => Promise<TopicDTO>) {
    if (busyRef.current || conflict) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setPublishIssues([]);
    try {
      await saveDraft();
      const next = await action(rowRef.current);
      accept(next);
      const synced = { ...formRef.current, reviewed: !next.needsExpertReview };
      formRef.current = synced;
      setForm(synced);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error);
      document
        .getElementById("lesson-editor-status")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (e instanceof EditorRequestError) {
        setPublishIssues(e.issues);
        if (e.status === 409 && e.code === "stale") setConflict(true);
      }
      throw e;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function status(status: "DRAFT" | "REVIEW") {
    try {
      await foreground((current) =>
        requestContent<TopicDTO>(`topics/${initial.id}/status`, "POST", {
          revision: current.editRevision,
          status,
        }),
      );
      setMessage(status === "REVIEW" ? t.reviewSent : t.saved);
    } catch {}
  }
  async function publish() {
    try {
      await foreground((current) =>
        requestContent<TopicDTO>(`topics/${initial.id}/publish`, "POST", {
          revision: current.editRevision,
        }),
      );
      setMessage(t.published);
    } catch {}
  }
  async function question(input: QuestionInput, id?: string) {
    const next = await foreground((current) =>
      requestContent<TopicDTO>(
        id ? `questions/${id}` : `topics/${initial.id}/questions`,
        id ? "PATCH" : "POST",
        { ...input, topicRevision: current.editRevision },
      ),
    );
    if (next) {
      setSelected(undefined);
      setQuestionNonce((n) => n + 1);
      setMessage(t.savedQuestion);
    }
  }
  async function removeQuestion(q: QuestionDTO) {
    if (!confirm(t.confirmDelete)) return;
    try {
      await foreground((current) =>
        requestContent<TopicDTO>(`questions/${q.id}`, "DELETE", {
          topicRevision: current.editRevision,
        }),
      );
      setSelected(undefined);
      setQuestionNonce((n) => n + 1);
      setMessage(t.deleted);
    } catch {}
  }
  async function removeTopic() {
    if (!confirm(t.confirmDelete)) return;
    try {
      await foreground(async (current) => {
        await requestContent(`topics/${initial.id}`, "DELETE", {
          revision: current.editRevision,
        });
        router.push(`/admin/subjects/${initial.subjectId}`);
        return current;
      });
    } catch {}
  }
  async function insertExercise(markdown: string, config: GapExercise) {
    const before = formRef.current.contentMd;
    const contentMd = before.trimEnd() + "\n\n" + markdown;
    const result = await requestContent<ParsedTopic>("preview", "POST", {
      contentMd,
    });
    if (result.errors.length) throw new Error(result.errors[0].message);
    if (formRef.current.contentMd !== before)
      throw new Error("Текст методички изменился. Повторите вставку.");
    const gap = result.gaps.at(-1);
    if (!gap) throw new Error("Пропуск не найден. Проверьте текст задания.");
    change("contentMd", contentMd);
    change("gapExercises", {
      ...formRef.current.gapExercises,
      [gap.gapKey]: config,
    });
    setParsed(result);
    setPreviewSource(contentMd);
  }
  function insertText(markdown: string) {
    const current = formRef.current.contentMd,
      input = textarea.current;
    const start = input?.selectionStart ?? current.length,
      end = input?.selectionEnd ?? start;
    change(
      "contentMd",
      current.slice(0, start) + "\n\n" + markdown + "\n\n" + current.slice(end),
    );
    requestAnimationFrame(() => {
      const field = textarea.current;
      if (field) {
        const after = start + markdown.length + 4;
        field.focus();
        field.setSelectionRange(after, after);
      }
    });
  }
  const checks = lessonReadiness(form, parsed, row.questions, {
    minQuestions,
    maxQuestions,
    subjectPublished: row.subject.status === "PUBLISHED",
    status: row.status,
    imageIds: [...new Set([...imageIds, ...(row.imageIds ?? [])])],
    previewCurrent: previewSource === form.contentMd,
  });
  const reviewPrompt = lessonReviewPrompt(
    form.contentMd,
    row.questions,
    form.referencesMd,
    parsed,
    form.gapExercises,
  );
  const issues = publishIssues.length ? publishIssues : parsed.errors;
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href={`/admin/subjects/${initial.subjectId}`}
          className="text-sm text-emerald-800 underline"
        >
          ← {t.backSubject}: {row.subject.title}
        </Link>
        <span className="rounded-full bg-stone-100 px-4 py-2 text-xs">
          {t.statuses[row.status]} · {t.version} {row.version}
        </span>
      </div>
      <nav
        aria-label="Этапы создания урока"
        className="flex flex-wrap gap-3 rounded-2xl border bg-white p-4 text-sm"
      >
        {[
          ["lesson-basics", "1. Основное"],
          ["lesson-text", "2. Методичка"],
          ["lesson-exercises", "3. Задания"],
          ["lesson-questions", "4. Тест"],
          ["lesson-review", "5. Проверка и публикация"],
        ].map(([id, title]) => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-emerald-900 underline"
          >
            {title}
          </a>
        ))}
      </nav>
      <p className="text-sm leading-7 text-stone-600">
        Создайте черновик, добавьте текст и задания, проверьте ответы в
        предпросмотре. Затем укажите источники и рецензента внизу страницы.
        Черновик сохраняется автоматически.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy || conflict}
          onClick={() => {
            void foreground(async (current) => current).catch(() => {});
          }}
        >
          {t.saveDraft}
        </Button>
        <a
          href="#lesson-review"
          className="inline-flex min-h-11 items-center px-3 text-sm text-emerald-800 underline"
        >
          Проверить урок перед публикацией
        </a>
      </div>
      <p
        id="lesson-editor-status"
        role="status"
        className="text-sm text-emerald-800"
      >
        {message}
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-800"
        >
          {error}
        </p>
      )}
      {conflict && (
        <Button
          variant="outline"
          onClick={() => {
            if (confirm(t.reloadConfirm)) window.location.reload();
          }}
        >
          {t.reload}
        </Button>
      )}
      <div className="grid gap-7 xl:grid-cols-2">
        <section className="space-y-5">
          <h2 id="lesson-basics" className="scroll-mt-5 text-xl font-semibold">
            1. Основные параметры
          </h2>
          <fieldset
            disabled={busy || conflict}
            className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 sm:grid-cols-2"
          >
            <label className="text-sm font-medium">
              {t.name}
              <input
                className={fieldClass}
                value={form.title}
                onChange={(e) => change("title", e.target.value)}
                maxLength={200}
              />
            </label>
            <label className="text-sm font-medium">
              {t.slug}
              <span
                className="mt-1 block text-xs font-normal leading-6 text-stone-500"
                aria-hidden="true"
              >
                Адрес темы латиницей. Обычно его можно оставить автоматически
                созданным.
              </span>
              <input
                className={fieldClass}
                aria-label={t.slug}
                value={form.slug}
                maxLength={100}
                onChange={(e) => change("slug", e.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              {t.section}
              <select
                className={fieldClass}
                value={form.sectionId ?? ""}
                onChange={(e) => change("sectionId", e.target.value || null)}
              >
                <option value="">{t.noSection}</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              {t.order}
              <input
                type="number"
                min={0}
                max={10000}
                className={fieldClass}
                value={form.order}
                onChange={(e) => change("order", Number(e.target.value))}
              />
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.isFree}
                onChange={(e) => change("isFree", e.target.checked)}
                className="size-5 accent-emerald-800"
              />
              {t.free}
            </label>
            <label className="text-sm font-medium">
              {t.readingMinutes}
              <input
                className={fieldClass}
                type="number"
                min={1}
                max={600}
                value={form.readingMinutes ?? ""}
                onChange={(e) =>
                  change(
                    "readingMinutes",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
            </label>
          </fieldset>
          <h2 id="lesson-text" className="scroll-mt-5 text-xl font-semibold">
            2. Текст методички
          </h2>
          <div className="rounded-xl bg-emerald-50 p-4 text-sm leading-7">
            Заголовки, списки и таблицы можно оформить кнопками ниже. Задания
            добавляются отдельным конструктором после текста. Картинку
            вставляйте кнопкой «Добавить изображение».
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Оформление текста">
            {[
              ["Заголовок", "## Новый раздел"],
              ["Список", "- Первый пункт\n- Второй пункт"],
              [
                "Таблица",
                "| Термин | Значение |\n| --- | --- |\n| Пример | Описание |",
              ],
              ["Важно", "> [!important] Важная мысль"],
            ].map(([title, md]) => (
              <button
                key={title}
                type="button"
                className="min-h-11 rounded-lg border bg-white px-3 text-sm"
                disabled={busy || conflict}
                onClick={() => insertText(md)}
              >
                {title}
              </button>
            ))}
          </div>
          <ImageUpload
            topicId={initial.id}
            maxBytes={imageMaxBytes}
            busy={busy || conflict}
            onInsert={(md, id) => {
              setImageIds((ids) => [...new Set([...ids, id])]);
              insertText(md);
            }}
          />
          <label className="block text-sm font-medium">
            {t.markdown}
            <span className="mt-2 block text-xs font-normal leading-6 text-stone-500">
              {t.syntax}
            </span>
            <span className="relative mt-3 block rounded-xl border border-stone-300 bg-white">
              <pre
                ref={pre}
                aria-hidden
                className="pointer-events-none absolute inset-0 m-0 overflow-hidden p-4 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-transparent"
              >
                {form.contentMd
                  .split(/(\[\[[\s\S]*?(?:\]\]|$))/g)
                  .map((part, i) =>
                    part.startsWith("[[") ? (
                      <span
                        key={i}
                        className={
                          part.endsWith("]]")
                            ? "rounded bg-emerald-100"
                            : "rounded bg-red-100"
                        }
                      >
                        {part}
                      </span>
                    ) : (
                      part
                    ),
                  )}
                {"\n"}
              </pre>
              <textarea
                ref={textarea}
                aria-label={t.markdown}
                value={form.contentMd}
                onChange={(e) => change("contentMd", e.target.value)}
                onScroll={(e) => {
                  if (pre.current) {
                    pre.current.scrollTop = e.currentTarget.scrollTop;
                    pre.current.scrollLeft = e.currentTarget.scrollLeft;
                  }
                }}
                disabled={busy || conflict}
                maxLength={100000}
                spellCheck={false}
                className="relative block h-[30rem] w-full resize-y bg-transparent p-4 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-stone-900 outline-offset-4 focus:outline-emerald-700"
              />
            </span>
          </label>
          {issues.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h3 className="text-sm font-semibold text-red-900">{t.errors}</h3>
              <ul className="mt-2 space-y-2 text-sm text-red-800">
                {issues.map((issue, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="min-h-11 text-left underline"
                      onClick={() => {
                        const input = textarea.current;
                        if (input) {
                          const at =
                            form.contentMd
                              .split("\n")
                              .slice(0, issue.line - 1)
                              .join("\n").length + (issue.line > 1 ? 1 : 0);
                          input.focus();
                          input.setSelectionRange(at, at);
                        }
                      }}
                    >
                      {t.line} {issue.line}: {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section
          aria-label={t.preview}
          className="min-w-0 rounded-2xl border border-emerald-900/10 bg-white p-6 xl:sticky xl:top-4 xl:max-h-[85vh] xl:self-start xl:overflow-auto"
        >
          <div className="mb-5 border-b border-stone-200 pb-4">
            <h2 className="text-xl font-semibold">{t.preview}</h2>
            <p className="mt-2 text-xs text-stone-500">
              {t.gaps}: {parsed.gaps.length} · {t.blocks}:{" "}
              {parsed.blocks.length}
            </p>
            <p className="mt-2 text-xs leading-5 text-stone-500">
              {t.previewNote}
            </p>
          </div>
          <MarkdownPreview
            markdown={previewSource}
            parsed={parsed}
            exercises={form.gapExercises ?? {}}
          />
        </section>
      </div>
      <h2 id="lesson-exercises" className="scroll-mt-5 text-2xl font-semibold">
        3. Задания в методичке
      </h2>
      <p className="text-sm leading-7 text-stone-600">
        Это короткие задания внутри текста. Для проверки ответа укажите эталон и
        допустимые варианты: ИИ здесь не нужен.
      </p>
      <GapInsertForm busy={busy || conflict} onInsert={insertExercise} />
      <GapExercisesEditor
        gaps={parsed.gaps}
        configs={form.gapExercises ?? {}}
        busy={busy || conflict}
        onChange={(configs) => change("gapExercises", configs)}
      />
      <section
        id="lesson-questions"
        className="scroll-mt-5 space-y-5 border-t border-stone-200 pt-7"
      >
        <h2 className="text-2xl font-semibold">
          4. {t.questions} · {row.questions.length}
        </h2>
        <p className="text-sm leading-7 text-stone-600">
          Итоговый тест: от {minQuestions} до {maxQuestions} вопросов. У каждого
          вопроса нужны правильный ответ и объяснение. Нажмите «Редактировать»,
          чтобы проверить вопрос в его предпросмотре.
        </p>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50">
                <th className="p-4">{t.order}</th>
                <th className="p-4">{t.stem}</th>
                <th className="p-4">{t.diagnostic}</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {row.questions.map((q) => (
                <tr key={q.id} className="border-b border-stone-100">
                  <td className="p-4">{q.order}</td>
                  <td className="p-4">{q.stem}</td>
                  <td className="p-4">{q.isDiagnostic ? "✓" : "—"}</td>
                  <td className="flex gap-4 p-4">
                    <button
                      type="button"
                      className="min-h-11 text-emerald-800 underline"
                      disabled={busy || conflict}
                      onClick={() => {
                        setSelected(q);
                        setQuestionNonce((n) => n + 1);
                      }}
                    >
                      {t.edit}
                    </button>
                    <button
                      type="button"
                      className="min-h-11 text-red-800 underline"
                      disabled={busy || conflict}
                      onClick={() => void removeQuestion(q)}
                    >
                      {t.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <QuestionForm
          key={`${selected?.id ?? "new"}-${questionNonce}`}
          initial={selected}
          blocks={parsed.blocks}
          busy={busy || conflict}
          onSave={question}
          onCancel={() => {
            setSelected(undefined);
            setQuestionNonce((n) => n + 1);
          }}
        />
      </section>
      <section
        id="lesson-review"
        className="scroll-mt-5 space-y-5 border-t border-stone-200 pt-7"
      >
        <h2 className="text-2xl font-semibold">5. Проверка и публикация</h2>
        <p className="text-sm leading-7 text-stone-600">
          Проверьте содержание, эталоны и объяснения. После этого заполните
          автора, рецензента и источники, отметьте экспертную проверку.
          Изменение текста или вопроса снимает отметку и возвращает
          опубликованный урок в черновик.
        </p>
        <fieldset
          disabled={busy || conflict}
          className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2"
        >
          <label className="text-sm font-medium">
            {t.author}
            <input
              className={fieldClass}
              maxLength={200}
              value={form.authorName ?? ""}
              onChange={(e) => change("authorName", e.target.value || null)}
            />
          </label>
          <label className="text-sm font-medium">
            {t.reviewer}
            <input
              className={fieldClass}
              maxLength={200}
              value={form.reviewerName ?? ""}
              onChange={(e) => change("reviewerName", e.target.value || null)}
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            {t.references}
            <textarea
              className={fieldClass}
              rows={3}
              maxLength={20000}
              value={form.referencesMd ?? ""}
              onChange={(e) => change("referencesMd", e.target.value || null)}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.reviewed}
              onChange={(e) => change("reviewed", e.target.checked)}
              className="size-5 accent-emerald-800"
            />
            {t.reviewed}
          </label>
          <p className="text-xs leading-6 text-stone-500 sm:col-span-2">
            {t.reviewNote} {t.publicationNote}
          </p>
        </fieldset>
        <LessonReview checks={checks} prompt={reviewPrompt} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy || conflict}
            onClick={() => void status("REVIEW")}
          >
            {t.sendReview}
          </Button>
          <Button
            type="button"
            disabled={busy || conflict}
            onClick={() => void publish()}
          >
            {t.publish}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || conflict}
            onClick={() => void status("DRAFT")}
          >
            {t.draft}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || conflict}
            onClick={() => void removeTopic()}
          >
            {t.remove}
          </Button>
        </div>
        <p className="text-sm leading-7 text-emerald-800">
          Состояние урока: {t.statuses[row.status]} · версия {row.version}.{" "}
          {message}
        </p>
      </section>
    </div>
  );
}
