"use client";
import { useState } from "react";
import type { lessonReadiness } from "@/lib/content/readiness";
export function LessonReview({
  checks,
  prompt,
}: {
  checks: ReturnType<typeof lessonReadiness>;
  prompt: string;
}) {
  const [message, setMessage] = useState("");
  return (
    <div className="lesson-readiness mt-6 space-y-5">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
        <h3 className="text-lg font-semibold">Готовность к публикации</h3>
        <p className="mt-2 text-sm leading-7">
          Проверено пунктов: {checks.filter((c) => c.ok).length} из{" "}
          {checks.length}. Это проверка заполнения и разметки. Медицинскую
          точность подтверждает рецензент.
        </p>
        <ul className="readiness-list mt-4 grid gap-3">
          {checks.map((c) => (
            <li key={c.id} className="rounded-xl border bg-white p-4">
              <a
                href={`#${c.target}`}
                className="text-sm font-semibold text-emerald-900 underline"
              >
                {c.ok ? "✓" : "○"} {c.label}
              </a>
              <p className="mt-2 text-xs leading-6 text-stone-600">{c.note}</p>
            </li>
          ))}
        </ul>
      </section>
      <details className="rounded-xl border bg-white p-5">
        <summary className="min-h-11 cursor-pointer font-semibold">
          Помощь ИИ при проверке урока
        </summary>
        <p className="mt-3 text-sm leading-7">
          Готовый запрос можно скопировать в выбранный вами ИИ-сервис.
          Автоматического вызова ИИ здесь пока нет. Ответ — замечания для
          рецензента; он не ставит отметку эксперта и не публикует урок.
        </p>
        <label className="mt-4 block text-sm">
          Запрос для проверки
          <textarea
            readOnly
            value={prompt}
            rows={9}
            className="mt-2 w-full rounded-xl border p-3 text-sm"
          />
        </label>
        <button
          type="button"
          className="lesson-primary mt-3"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(prompt);
              setMessage("Запрос скопирован.");
            } catch {
              setMessage("Выделите текст запроса и скопируйте вручную.");
            }
          }}
        >
          Скопировать запрос с текстом урока
        </button>
        {message && (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </details>
    </div>
  );
}
