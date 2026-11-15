"use client";
import { useState } from "react";
import { diffLines, diffQuestions } from "@/lib/content/diff";
import { MarkdownPreview } from "@/components/content/markdown-preview";
import type {
  QuestionDTO,
  TopicDTO,
  RevisionDTO,
  RevisionSummary,
} from "@/lib/content/types";
import type { TopicInput } from "@/lib/content/validation";
import { requestContent } from "./helpers";
import { Button } from "@/components/ui/button";
const labels = { added: "Добавлен", removed: "Удалён", changed: "Изменён" };
function QuestionSnapshot({ question }: { question: QuestionDTO }) {
  return (
    <div className="space-y-2 rounded bg-stone-50 p-3 text-sm">
      <p className="font-medium">{question.stem}</p>
      <p>
        Тип:{" "}
        {
          {
            SINGLE_CHOICE: "Один ответ",
            MULTIPLE_CHOICE: "Несколько ответов",
            SHORT_TEXT: "Текстовый ответ",
          }[question.answerType]
        }
      </p>
      <ul>
        {question.options.map((option) => (
          <li key={option.id}>
            {question.correctOptionIds.includes(option.id) ? "✓ " : "○ "}
            {option.text}
          </li>
        ))}
      </ul>
      {question.acceptedAnswers.length > 0 && (
        <p>Эталоны: {question.acceptedAnswers.join("; ")}</p>
      )}
      <p>Объяснение: {question.explanation}</p>
      <p>
        Порядок: {question.order + 1} ·{" "}
        {question.isDiagnostic ? "Используется в диагностике" : "Тест урока"}
      </p>
    </div>
  );
}
export function PublicationTools({
  row,
  form,
  timeZone,
}: {
  row: TopicDTO;
  form: TopicInput;
  timeZone: string;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [history, setHistory] = useState<RevisionSummary[] | null>(null);
  const [snapshot, setSnapshot] = useState<RevisionDTO | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(id?: string) {
    setBusy(true);
    setError("");
    try {
      if (id)
        setSnapshot(
          await requestContent<RevisionDTO>(`revisions/${id}`, "GET"),
        );
      else
        setHistory(
          await requestContent<RevisionSummary[]>(
            `topics/${row.id}/revisions`,
            "GET",
          ),
        );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить историю.",
      );
    } finally {
      setBusy(false);
    }
  }
  const changes = diffQuestions(row.published?.questions ?? [], row.questions);
  return (
    <div className="space-y-4">
      {row.published && (
        <details
          className="rounded-xl border p-4"
          onToggle={(e) => setCompareOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer font-medium">
            Сравнить с опубликованной
          </summary>
          {compareOpen && (
            <>
              <p className="my-3 text-sm">
                Красный — удалено, зелёный — добавлено. Сравнение включает
                текущий текст редактора.
              </p>
              {(
                [
                  "title",
                  "readingMinutes",
                  "authorName",
                  "reviewerName",
                  "referencesMd",
                  "gapExercises",
                ] as const
              ).map(
                (key) =>
                  JSON.stringify(row.published![key]) !==
                    JSON.stringify(form[key]) && (
                    <p key={key} className="my-2 text-sm">
                      Изменено:{" "}
                      {
                        {
                          title: "Название",
                          readingMinutes: "Время чтения",
                          authorName: "Автор",
                          reviewerName: "Рецензент",
                          referencesMd: "Источники",
                          gapExercises: "Настройки пропусков",
                        }[key]
                      }
                    </p>
                  ),
              )}
              <pre
                aria-label="Сравнение текста"
                className="max-h-96 overflow-auto whitespace-pre-wrap rounded border text-sm"
              >
                {diffLines(row.published.contentMd, form.contentMd).map(
                  (line, i) => (
                    <span
                      key={i}
                      className={`block px-3 ${line.kind === "added" ? "bg-emerald-50 text-emerald-900" : line.kind === "removed" ? "bg-red-50 text-red-900" : ""}`}
                    >
                      {line.kind === "added"
                        ? "+ "
                        : line.kind === "removed"
                          ? "− "
                          : "  "}
                      {line.text}
                      {"\n"}
                    </span>
                  ),
                )}
              </pre>
              <h3 className="my-3 font-medium">Изменения вопросов</h3>
              {!changes.length && (
                <p className="text-sm">Вопросы не изменились.</p>
              )}
              {changes.map((change) => (
                <div
                  className="my-3 rounded border p-3 text-sm"
                  key={(change.after ?? change.before)!.id}
                >
                  <p className="font-medium">
                    {labels[change.kind]}:{" "}
                    {(change.after ?? change.before)!.stem}
                  </p>
                  {change.before &&
                    change.after &&
                    change.before.sourceBlockKey !==
                      change.after.sourceBlockKey && (
                      <p>Блок-источник изменён.</p>
                    )}
                  {change.before && (
                    <div className="my-2">
                      <p>Было:</p>
                      <QuestionSnapshot question={change.before} />
                    </div>
                  )}
                  {change.after && (
                    <div className="my-2">
                      <p>Стало:</p>
                      <QuestionSnapshot question={change.after} />
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </details>
      )}
      <details
        className="rounded-xl border p-4"
        onToggle={(e) => {
          if (e.currentTarget.open && history === null && !busy) void load();
        }}
      >
        <summary className="cursor-pointer font-medium">
          История публикаций
        </summary>
        {error && (
          <p role="alert" className="my-3 text-red-800">
            {error}
          </p>
        )}
        {busy && <p role="status">Загрузка…</p>}
        {history?.length === 0 && (
          <p className="my-3 text-sm">Публикаций пока нет.</p>
        )}
        <ul className="my-3 space-y-2">
          {history?.map((revision) => (
            <li
              key={revision.id}
              className="flex flex-wrap items-center gap-3 text-sm"
            >
              <span>
                Версия {revision.version} ·{" "}
                {new Date(revision.publishedAt).toLocaleString("ru-RU", {
                  timeZone,
                })}{" "}
                · {revision.publishedBy?.name ?? "Автор не указан"}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void load(revision.id)}
              >
                Смотреть версию {revision.version}
              </Button>
            </li>
          ))}
        </ul>
        {snapshot && (
          <article
            aria-label={`Снимок версии ${snapshot.version}`}
            className="space-y-3 border-t pt-4"
          >
            <p className="text-sm">Снимок публикации · только для чтения</p>
            <h3 className="text-xl font-semibold">{snapshot.title}</h3>
            <MarkdownPreview
              key={snapshot.id}
              markdown={snapshot.contentMd}
              parsed={snapshot.parsed}
              exercises={snapshot.gapExercises}
            />
            <h4>Вопросы теста</h4>
            {snapshot.questions.map((question) => (
              <QuestionSnapshot key={question.id} question={question} />
            ))}
          </article>
        )}
      </details>
    </div>
  );
}
