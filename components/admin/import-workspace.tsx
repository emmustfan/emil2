"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { ImportDTO } from "@/lib/imports/service";
type Subject = {
  id: string;
  title: string;
  sections: { id: string; title: string }[];
};
const stageNames: Record<string, string> = {
  queued: "В очереди",
  extracting: "Извлечение текста",
  generating: "Подготовка черновиков",
  done: "Черновики готовы",
  failed: "Не удалось обработать",
};
export function ImportWorkspace({
  subjects,
  initial,
  initialSubject,
  maxBytes,
  timeZone,
  mock,
}: {
  subjects: Subject[];
  initial: ImportDTO[];
  initialSubject?: string;
  maxBytes: number;
  timeZone: string;
  mock: boolean;
}) {
  const [subjectId, setSubjectId] = useState(
      subjects.some((s) => s.id === initialSubject)
        ? initialSubject!
        : (subjects[0]?.id ?? ""),
    ),
    [sectionId, setSectionId] = useState(""),
    [mode, setMode] = useState("file"),
    [jobs, setJobs] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = jobs.some((j) => ["queued", "processing"].includes(j.status));
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const r = await fetch("/api/admin/imports", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) throw new Error();
        setJobs(await r.json());
        setNotice("");
      } catch {
        if (!controller.signal.aborted)
          setNotice(
            "Статус временно недоступен. Обновление повторится автоматически.",
          );
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, 2000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [active]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = event.currentTarget,
      data = new FormData(form);
    data.set("subjectId", subjectId);
    data.set("sectionId", sectionId);
    data.set(
      "rightsConfirmed",
      data.get("rightsConfirmed") === "on" ? "true" : "false",
    );
    try {
      const file = data.get("file");
      if (file instanceof File && file.size > maxBytes)
        throw new Error("Файл превышает допустимый размер.");
      const r = await fetch("/api/admin/imports", {
          method: "POST",
          body: data,
        }),
        value = await r.json();
      if (!r.ok)
        throw new Error(value.error ?? "Не удалось загрузить материал.");
      const status = await fetch(`/api/admin/imports/${value.id}`, {
        cache: "no-store",
      });
      if (status.ok) {
        const job = await status.json();
        setJobs((previous) =>
          [job, ...previous.filter((j) => j.id !== job.id)].slice(0, 30),
        );
      } else {
        setJobs((previous) =>
          [
            {
              id: value.id,
              subjectId,
              status: "queued",
              stage: "queued",
              error: null,
              partsDone: 0,
              partsTotal: 0,
              createdAt: new Date().toISOString(),
              finishedAt: null,
              topics: [],
            },
            ...previous,
          ].slice(0, 30),
        );
      }
      form.reset();
      setSectionId("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить материал.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form
        onSubmit={submit}
        className="min-w-0 space-y-5 rounded-2xl border border-stone-200 bg-white p-5 sm:p-7"
      >
        <h2 className="text-xl font-semibold">Новый импорт</h2>
        {mock && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6">
            Включён тестовый ИИ: он создаёт технические примеры из исходника для
            проверки процесса. Преподавателю нужно переработать их. Для
            содержательных ИИ-черновиков позже подключим модель в разделе
            «Интеграции».
          </p>
        )}
        <label className="block text-sm font-medium">
          Предмет
          <select
            aria-label="Предмет"
            required
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setSectionId("");
            }}
            className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-stone-300 px-3"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Раздел
          <select
            aria-label="Раздел"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 px-3"
          >
            <option value="">Без раздела</option>
            {subjects
              .find((s) => s.id === subjectId)
              ?.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
          </select>
        </label>
        <fieldset className="flex flex-wrap gap-5 text-sm">
          <legend className="mb-3 font-medium">Источник</legend>
          {[
            ["file", "Загрузить файл"],
            ["text", "Вставить текст"],
          ].map(([value, label]) => (
            <label
              key={value}
              className="inline-flex min-h-11 items-center gap-2"
            >
              <input
                type="radio"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {mode === "file" ? (
          <label className="block text-sm">
            Файл PDF, DOCX или TXT
            <input
              required
              type="file"
              name="file"
              accept=".pdf,.docx,.txt"
              className="mt-2 block min-h-11 w-full min-w-0 text-sm"
            />
            <span className="mt-2 block text-xs leading-6 text-stone-500">
              До {Math.round(maxBytes / 1048576)} МБ. PDF должен содержать
              текст: сканы пока не распознаются. Изображения из документа
              автоматически не переносятся.
            </span>
          </label>
        ) : (
          <label className="block text-sm">
            Текст источника
            <textarea
              required
              name="text"
              rows={10}
              maxLength={60000}
              className="mt-2 w-full rounded-lg border border-stone-300 p-3"
            />
          </label>
        )}
        <p className="text-sm leading-6 text-stone-600">
          Удалите данные пациентов и другие персональные сведения. После
          обработки исходный файл удаляется из хранилища. Длинный текст будет
          разделён на несколько тем.
        </p>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            required
            type="checkbox"
            name="rightsConfirmed"
            className="mt-1 h-4 w-4 shrink-0"
          />
          У нас есть права на этот материал
        </label>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <button disabled={busy || !subjectId} className="lesson-primary">
          {busy ? "Загружаем…" : "Создать черновики"}
        </button>
        {!subjects.length && (
          <p className="text-sm leading-6">
            Сначала создайте предмет или попросите администратора закрепить его
            за вами.
          </p>
        )}
      </form>
      <section className="min-w-0" aria-label="Задачи импорта">
        <h2 className="text-xl font-semibold">Последние импорты</h2>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Можно уйти с этой страницы и вернуться: обработка продолжится. Если
          очередь долго не движется, проверьте, запущен ли worker.
        </p>
        {notice && (
          <p role="status" className="mt-3 text-sm">
            {notice}
          </p>
        )}
        <div aria-live="polite" className="mt-5 space-y-4">
          {!jobs.length && (
            <p className="rounded-xl bg-stone-50 p-5 text-sm">
              Здесь появятся загруженные материалы и ссылки на готовые
              черновики.
            </p>
          )}
          {jobs.map((j) => (
            <article
              key={j.id}
              data-import-id={j.id}
              className="min-w-0 rounded-2xl border border-stone-200 bg-white p-5"
            >
              <p className="font-medium">
                {stageNames[j.stage] ?? "В обработке"}
              </p>
              <p className="mt-2 text-xs text-stone-500">
                {subjects.find((s) => s.id === j.subjectId)?.title ?? "Предмет"}{" "}
                · {new Date(j.createdAt).toLocaleString("ru-RU", { timeZone })}
              </p>
              {j.status === "processing" && j.partsTotal > 0 && (
                <p className="mt-3 text-sm">
                  Подготовлено частей: {j.partsDone} из {j.partsTotal}
                </p>
              )}
              {j.error && (
                <p className="mt-3 text-sm leading-6 text-red-800">{j.error}</p>
              )}
              {j.topics.map((topic) => (
                <Link
                  key={topic.id}
                  href={`/admin/topics/${topic.id}`}
                  className="mt-3 flex min-h-11 items-center break-words text-emerald-800 underline"
                >
                  Открыть черновик: {topic.title}
                </Link>
              ))}
              {j.status === "done" && (
                <p className="mt-3 text-xs leading-6 text-stone-500">
                  Требуется проверка эксперта. Все темы сохранены как черновики.
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
