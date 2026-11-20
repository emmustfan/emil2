"use client";

import { useEffect, useState } from "react";
import type { VideoMetadata } from "@/lib/content/types";
import type { ImportDTO } from "@/lib/imports/service";
import { videoTime } from "@/lib/video/rutube";
import { fieldClass } from "./helpers";

export function VideoEditor({
  topicId,
  subjectId,
  videos,
  busy,
  onChange,
  onInsert,
}: {
  topicId: string;
  subjectId: string;
  videos: VideoMetadata[];
  busy: boolean;
  onChange: (video: VideoMetadata | string) => void;
  onInsert: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const selected = videos.find((video) => video.id === editing);

  async function update(path: string, method: string, body?: unknown) {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/videos/${path}`, {
        method,
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onChange(method === "DELETE" ? path : (data as VideoMetadata));
      if (path === "new") onInsert(data.id);
      setEditing(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось сохранить видео.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="emal-panel space-y-4" id="lesson-videos">
      <h3 className="text-lg font-semibold">Видео</h3>
      <p className="text-sm">
        Видео доступно всем, у кого есть ссылка. Не размещайте видео, на которых
        можно узнать пациента без его письменного согласия.
      </p>
      <button
        type="button"
        className="lesson-secondary"
        disabled={busy || pending}
        onClick={() => setEditing("new")}
      >
        Добавить видео
      </button>
      {videos.map((video) => (
        <article
          className="space-y-3 rounded-xl border p-4"
          key={video.id}
          id={`editor-video-${video.id}`}
        >
          <h4 className="font-semibold">{video.title}</h4>
          <div className="flex flex-wrap gap-4 text-sm">
            <button
              type="button"
              className="underline"
              disabled={busy || pending}
              onClick={() => onInsert(video.id)}
            >
              Вставить блок
            </button>
            <button
              type="button"
              className="underline"
              disabled={busy || pending}
              onClick={() => setEditing(video.id)}
            >
              Изменить ссылку
            </button>
            <button
              type="button"
              className="underline"
              disabled={busy || pending}
              onClick={() => void update(video.id, "DELETE")}
            >
              Архивировать
            </button>
          </div>
          <VideoImport id={video.id} subjectId={subjectId} />
        </article>
      ))}
      {editing && (
        <form
          key={editing}
          className="space-y-3 rounded-xl border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void update(editing, "POST", {
              topicId,
              title: form.get("title"),
              link: form.get("link"),
              duration: form.get("duration"),
              consent: form.has("consent"),
            });
          }}
        >
          <label className="block">
            Название лекции
            <input
              className={fieldClass}
              name="title"
              required
              maxLength={200}
              defaultValue={selected?.title ?? ""}
            />
          </label>
          <label className="block">
            Ссылка или код iframe Rutube
            <textarea
              className={fieldClass}
              name="link"
              required
              maxLength={4000}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block">
            Длительность (мм:сс или чч:мм:сс)
            <input
              className={fieldClass}
              name="duration"
              maxLength={12}
              defaultValue={
                selected?.durationSec ? videoTime(selected.durationSec) : ""
              }
              placeholder="45:00"
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input name="consent" type="checkbox" required /> В видео нет
            персональных данных пациентов, либо есть их согласие
          </label>
          <div className="flex gap-3">
            <button className="lesson-primary" disabled={busy || pending}>
              Сохранить видео
            </button>
            <button
              type="button"
              className="lesson-secondary"
              disabled={pending}
              onClick={() => setEditing(null)}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role="alert" className="text-sm text-red-800">
          {message}
        </p>
      )}
    </section>
  );
}

function VideoImport({ id, subjectId }: { id: string; subjectId: string }) {
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<ImportDTO | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const ended = job?.status === "done" || job?.status === "failed";
  useEffect(() => {
    if (!jobId || ended) return;
    const abort = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/admin/imports/${jobId}`, {
          signal: abort.signal,
        });
        if (response.ok) setJob(await response.json());
      } catch {
        if (!abort.signal.aborted)
          setError("Не удалось получить статус импорта.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [jobId, ended]);
  const report = job?.report as
    | {
        checkpoints: number;
        testQuestions: number;
        rejected: Record<string, number>;
      }
    | undefined;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">
        Сгенерировать задания
      </summary>
      <form
        className="mt-3 space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          const form = event.currentTarget;
          const body = new FormData(form);
          setPending(true);
          setError("");
          body.set("rightsConfirmed", String(body.has("rightsConfirmed")));
          body.set("videoId", id);
          body.set("subjectId", subjectId);
          try {
            const response = await fetch("/api/admin/imports", {
              method: "POST",
              body,
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            setJob(null);
            setJobId(data.id);
            form.reset();
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Не удалось загрузить исходник.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="block">
          Расшифровка или слайды
          <input
            className="block max-w-full"
            name="file"
            type="file"
            accept=".vtt,.srt,.txt,.docx,.pdf"
            required
          />
        </label>
        <label className="flex items-start gap-2">
          <input name="rightsConfirmed" type="checkbox" required /> Подтверждаю
          право использовать файл. В нём нет персональных данных пациентов.
        </label>
        <button
          className="lesson-secondary"
          disabled={pending || (!!jobId && !ended)}
        >
          Загрузить и сгенерировать
        </button>
      </form>
      {jobId && !ended && <p role="status">В очереди или обрабатывается.</p>}
      {(error || job?.error) && (
        <p role="alert" className="text-red-800">
          {error || job?.error}
        </p>
      )}
      {job?.status === "done" && report && (
        <div role="status" className="space-y-2">
          <p>
            В черновик добавлено вопросов в видео — {report.checkpoints},
            вопросов теста — {report.testQuestions}.
          </p>
          <p>
            Отброшено из-за формата — {report.rejected.format}, цитаты —{" "}
            {report.rejected.quote}, времени — {report.rejected.time}, лимита —{" "}
            {report.rejected.limit}.
          </p>
          <p>
            Сохраните текущие правки и обновите страницу для проверки черновика.
          </p>
        </div>
      )}
    </details>
  );
}
