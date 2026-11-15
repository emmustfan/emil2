"use client";
import { useEffect, useState } from "react";
import type { GapHistory } from "@/lib/lessons/history";
export function GapAnswerHistory({
  topicId,
  revision,
}: {
  topicId: string;
  revision: number;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<GapHistory | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/lessons/${topicId}/history`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error ?? "Не удалось загрузить историю.");
        setRows(value);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить историю.",
          );
      });
    return () => controller.abort();
  }, [open, topicId, revision]);
  return (
    <details
      className="mt-8 rounded-xl border bg-white p-5"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">История ответов</summary>
      <p className="mt-3 text-sm text-stone-500">
        Все ваши ответы на пропуски, включая практику. Статистика первого ответа
        сохраняется.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-red-800">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="mt-3">Загрузка…</p>}
      {rows?.length === 0 && <p className="mt-3">Ответов пока нет.</p>}
      <ol className="mt-4 space-y-3">
        {rows?.map((row) => (
          <li key={row.id} className="rounded border p-3 text-sm">
            <p>{row.sentence}</p>
            <p className="mt-1">
              Ваш ответ: {row.text ?? row.chosen.join("; ")} ·{" "}
              {row.correct ? "Верно" : "Неверно"}
            </p>
            <p className="mt-1 text-stone-500">
              {new Date(row.at).toISOString().slice(0, 19).replace("T", " ")}{" "}
              UTC · {row.practice ? "Практика" : "Ответ в уроке"} · Версия{" "}
              {row.version}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}
