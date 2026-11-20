"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClientReady } from "@/lib/use-client-ready";
import { AnswerCard } from "@/components/exercises/answer-card";
import type { Submission } from "@/lib/exercises";
import type {
  LessonProgress,
  LessonReview,
  LessonVideo,
  QuestionFeedback,
} from "@/lib/lessons/types";
import type { WatchRange } from "@/lib/video/ranges";
import { RUTUBE_ORIGIN, videoTime } from "@/lib/video/rutube";
import { readRutubeEvent, rutubeCommand } from "@/lib/video/rutube-protocol";

async function save<T>(
  videoId: string,
  action: string,
  data: unknown,
  keepalive = false,
): Promise<T> {
  const response = await fetch(`/api/videos/${videoId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    keepalive,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Не удалось сохранить данные видео.");
  return body as T;
}

const ignore = () => {};

type ProgressResponse = {
  video: LessonVideo["progress"];
  progress: LessonProgress;
};

export function RutubePlayer({
  video,
  version,
  onProgress = ignore,
  onReview = ignore,
}: {
  video: LessonVideo;
  version: number;
  onProgress?: (data: LessonProgress) => void;
  onReview?: (data: LessonReview) => void;
}) {
  const hydrated = useClientReady();
  const iframe = useRef<HTMLIFrameElement>(null);
  const engine = useRef({
    ranges: [] as WatchRange[],
    position: video.progress?.lastPositionSec ?? 0,
    tick: 0,
    playing: false,
    stateReceived: false,
    timeReceived: false,
    advancing: false,
    lastSent: -1,
    answered: new Set(
      video.questions.filter((q) => q.feedback).map((q) => q.id),
    ),
    skipped: new Set<string>(),
    active: "",
    forceFlush: ignore as (keepalive: boolean) => void,
  });
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [fallback, setFallback] = useState(video.durationSec === null);
  const [progress, setProgress] = useState(video.progress);
  const [feedback, setFeedback] = useState(
    () =>
      new Map(
        video.questions.flatMap((q) =>
          q.feedback ? [[q.id, q.feedback] as const] : [],
        ),
      ),
  );
  const [questionId, setQuestionId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const current = video.questions.find((q) => q.id === questionId);

  function send(command: "seek" | "pause" | "play", time?: number) {
    iframe.current?.contentWindow?.postMessage(
      rutubeCommand(command, time),
      RUTUBE_ORIGIN,
    );
  }

  useEffect(() => {
    const state = engine.current;
    let inFlight = false;
    let alive = true;
    function flush(keepalive = false) {
      if (!video.allowWrites || (!keepalive && inFlight)) return;
      if (!state.ranges.length && state.lastSent === state.position) return;
      if (!state.ranges.length && !state.advancing) return;
      const ranges = state.ranges.splice(0, 120);
      const position = state.position;
      inFlight = true;
      void save<ProgressResponse>(
        video.id,
        "progress",
        { ranges, position, version },
        keepalive,
      )
        .then((result) => {
          state.lastSent = position;
          if (alive) {
            setProgress(result.video);
            onProgress(result.progress);
          }
        })
        .catch(() => state.ranges.unshift(...ranges))
        .finally(() => {
          inFlight = false;
        });
    }
    state.forceFlush = flush;
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== RUTUBE_ORIGIN ||
        event.source !== iframe.current?.contentWindow
      )
        return;
      const message = readRutubeEvent(event.data);
      if (!message) return;
      if (message.kind === "state") state.stateReceived = true;
      if (message.kind === "time") state.timeReceived = true;
      if (
        video.durationSec !== null &&
        state.stateReceived &&
        state.timeReceived
      )
        setFallback(false);
      if (message.kind === "ready") {
        const hash = window.location.hash;
        const prefix = `#video-${video.id}-at-`;
        const raw = hash.startsWith(prefix) ? hash.slice(prefix.length) : "";
        const requested = /^\d{1,5}$/.test(raw)
          ? Number(raw)
          : (video.progress?.lastPositionSec ?? 0);
        if (requested && requested <= (video.durationSec ?? 86400)) {
          send("seek", requested);
          if (raw) iframe.current?.scrollIntoView({ block: "center" });
        }
        return;
      }
      if (message.kind === "state") {
        state.playing = message.playing;
        if (!message.playing) {
          state.tick = 0;
          flush();
        }
        return;
      }
      const before = state.position;
      const position = message.position;
      if (position > (video.durationSec ?? 86400) + 5) return;
      const now = performance.now();
      const delta = position - before;
      const continuous =
        state.playing &&
        state.tick > 0 &&
        delta > 0 &&
        delta <= Math.min(5, 1.5 + (now - state.tick) * 0.0025);
      state.position = position;
      state.tick = now;
      if (continuous) {
        state.advancing = true;
        const last = state.ranges.at(-1);
        if (last && last[1] === before && position - last[0] <= 20)
          last[1] = position;
        else state.ranges.push([before, position]);
      }
      if (state.playing && !state.active && video.allowWrites) {
        const q = video.questions.find(
          (q) =>
            q.atSec >= before &&
            q.atSec <= position &&
            !state.answered.has(q.id) &&
            !state.skipped.has(q.id),
        );
        if (q) {
          state.active = q.id;
          state.playing = false;
          setQuestionId(q.id);
          send("pause");
          flush();
        }
      }
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flush(true);
    }
    function onHide() {
      flush(true);
    }
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    const interval = setInterval(() => flush(), 15000);
    return () => {
      alive = false;
      flush(true);
      clearInterval(interval);
      clearTimeout(timeout.current);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [video, version, onProgress]);

  async function answer(input: Submission) {
    if (!current || pending) return;
    setPending(true);
    setError("");
    try {
      const data = await save<{
        feedback: QuestionFeedback;
        review: LessonReview;
      }>(video.id, "answer", {
        ...input,
        version,
        questionId: current.id,
      });
      engine.current.answered.add(current.id);
      setFeedback((old) => new Map(old).set(current.id, data.feedback));
      onReview(data.review);
      window.dispatchEvent(new Event("srs:changed"));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не удалось сохранить ответ.",
      );
    } finally {
      setPending(false);
    }
  }

  async function selfReport() {
    setPending(true);
    setError("");
    try {
      const result = await save<ProgressResponse>(video.id, "progress", {
        selfReported: true,
        version,
      });
      setProgress(result.video);
      onProgress(result.progress);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить просмотр.",
      );
    } finally {
      setPending(false);
    }
  }

  function resume() {
    if (current && !feedback.has(current.id))
      engine.current.skipped.add(current.id);
    engine.current.active = "";
    setQuestionId("");
    send("play");
  }

  const result = current && feedback.get(current.id);
  return (
    <section
      className="my-6 space-y-4"
      id={`video-${video.id}`}
      aria-label={video.title}
    >
      {hydrated ? (
        <iframe
          ref={iframe}
          src={video.src}
          title={video.title}
          className="aspect-video w-full rounded-xl bg-stone-900"
          allow="clipboard-write; autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            clearTimeout(timeout.current);
            timeout.current = setTimeout(() => {
              if (!engine.current.stateReceived || !engine.current.timeReceived)
                setFallback(true);
            }, 10000);
          }}
          onError={() => setFallback(true)}
        />
      ) : (
        <div
          className="aspect-video w-full rounded-xl bg-stone-900"
          aria-hidden
        />
      )}
      {progress && !progress.completed && video.durationSec !== null && (
        <p className="text-sm">
          Просмотрено {videoTime(progress.watchedSec)} из{" "}
          {videoTime(video.durationSec)}
        </p>
      )}
      {progress?.completed && (
        <p role="status">
          {progress.selfReported
            ? "Просмотр отмечен студентом."
            : "Видеолекция просмотрена."}
        </p>
      )}
      {fallback && video.allowWrites && !progress?.completed && (
        <button
          type="button"
          className="lesson-secondary"
          disabled={pending}
          onClick={() => void selfReport()}
        >
          Я посмотрел лекцию
        </button>
      )}
      {!video.signedIn && (
        <p className="text-sm">
          <Link className="underline" href="/login">
            Войдите
          </Link>
          , чтобы сохранить просмотр и ответить на вопросы.
        </p>
      )}
      {current && (
        <div className="space-y-3">
          <AnswerCard
            key={current.id}
            id={current.id}
            title="Вопрос в видео"
            description={current.stem}
            answerType={current.answerType}
            options={current.options}
            pending={pending || !video.allowWrites}
            feedback={
              result
                ? {
                    correct: result.correct,
                    chosenValues:
                      current.answerType === "SHORT_TEXT"
                        ? [result.chosenText ?? ""]
                        : current.options
                            .filter((o) => result.chosenIds.includes(o.id))
                            .map((o) => o.text),
                    correctValues:
                      current.answerType === "SHORT_TEXT"
                        ? [result.answerText ?? ""]
                        : current.options
                            .filter((o) => result.correctIds.includes(o.id))
                            .map((o) => o.text),
                    explanation: result.explanation,
                  }
                : null
            }
            onAnswer={(input) => void answer(input)}
          />
          <button
            type="button"
            className="lesson-primary"
            disabled={pending}
            onClick={resume}
          >
            {result ? "Продолжить" : "Пропустить"}
          </button>
        </div>
      )}
      <div className="space-y-2 text-sm">
        <p>
          Вопросы к видео: {video.questions.length}, отвечено {feedback.size}
        </p>
        <ul className="space-y-1">
          {video.questions.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-x-3">
              <button
                type="button"
                className="min-h-11 underline"
                onClick={() => {
                  engine.current.tick = 0;
                  send("seek", q.atSec);
                }}
              >
                Перейти к моменту {videoTime(q.atSec)}
              </button>
              {(video.allowWrites || feedback.has(q.id)) && (
                <button
                  className="min-h-11 underline"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    engine.current.active = q.id;
                    setQuestionId(q.id);
                    send("pause");
                    engine.current.forceFlush(false);
                  }}
                >
                  {feedback.has(q.id) ? "Посмотреть ответ" : "Открыть вопрос"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
