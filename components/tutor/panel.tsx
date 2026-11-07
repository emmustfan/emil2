"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { containsPersonalData } from "@/lib/tutor/privacy";
import { tutorRu as t } from "@/lib/i18n/ru";
import { sseData } from "@/lib/llm/sse";
import type {
  ExplainInput,
  Quota,
  TutorEvent,
  TutorInput,
  TutorReply,
} from "@/lib/tutor/types";
export type TutorHandle = { explain: (input: ExplainInput) => void };
type Entry = {
  role: "user" | "assistant";
  key: string;
  content: string;
  reply?: TutorReply;
};
function AnswerText({ reply }: { reply: TutorReply }) {
  return (
    <p className="whitespace-pre-wrap break-words leading-8">
      {reply.content.split(/(\[\d+\])/g).map((part, i) => {
        const n = part.match(/^\[(\d+)\]$/)?.[1],
          source = n
            ? reply.citations.find((c) => c.n === Number(n))
            : undefined;
        return source ? (
          <a
            key={i}
            href={source.href}
            className="rounded bg-emerald-100 px-1 text-emerald-900 underline"
            aria-label={t.sourceLabel(source.n, source.topicTitle)}
          >
            {part}
          </a>
        ) : (
          part
        );
      })}
    </p>
  );
}
export function TutorPanel({
  topicId,
  subjectId,
  mock,
  ref,
}: {
  topicId?: string;
  subjectId?: string;
  mock: boolean;
  ref?: Ref<TutorHandle>;
}) {
  const [text, setText] = useState(""),
    [messages, setMessages] = useState<Entry[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [quota, setQuota] = useState<Quota | null>(null),
    [retry, setRetry] = useState<TutorInput | null>(null);
  const conversation = useRef<string | undefined>(undefined),
    inFlight = useRef(false),
    root = useRef<HTMLElement>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/tutor/quota", { cache: "no-store", signal: abort.signal })
      .then(async (r) => {
        if (r.ok) setQuota(await r.json());
      })
      .catch(() => {});
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, []);
  const send = useCallback(async (input: TutorInput) => {
    if (inFlight.current) return;
    if (input.kind === "question" && containsPersonalData(input.text)) {
      setError(t.personalData);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    setRetry(null);
    const abort = new AbortController();
    controller.current = abort;
    const key = input.requestId,
      answerKey = key + "-answer";
    setMessages((old) => [
      ...old.filter((m) => m.key !== key && m.key !== answerKey),
      {
        role: "user",
        key,
        content: input.kind === "question" ? input.text : t.sentExplanation,
      },
      { role: "assistant", key: answerKey, content: "" },
    ]);
    let done = false;
    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          conversationId: conversation.current ?? input.conversationId,
        }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const data = await response.json();
        if (data.quota) setQuota(data.quota);
        throw new Error(data.error ?? t.failure);
      }
      if (!response.body) throw new Error(t.failure);
      for await (const data of sseData(response.body, abort.signal)) {
        const event = JSON.parse(data) as TutorEvent;
        if (event.type === "start") {
          conversation.current = event.conversationId;
          setQuota(event.quota);
        }
        if (event.type === "delta")
          setMessages((old) =>
            old.map((m) =>
              m.key === answerKey
                ? { ...m, content: m.content + event.text }
                : m,
            ),
          );
        if (event.type === "done") {
          done = true;
          setQuota(event.quota);
          setMessages((old) =>
            old.map((m) =>
              m.key === answerKey
                ? { ...m, content: event.message.content, reply: event.message }
                : m,
            ),
          );
        }
        if (event.type === "error") {
          if (event.quota) setQuota(event.quota);
          throw new Error(event.error);
        }
      }
      if (!done) throw new Error(t.failure);
      setText("");
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : t.failure);
        setRetry(input);
        setMessages((old) => old.filter((m) => m.key !== answerKey));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      explain: (input) => {
        root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        void send({ ...input, requestId: crypto.randomUUID() });
      },
    }),
    [send],
  );
  async function feedback(reply: TutorReply, value: 1 | -1) {
    try {
      const r = await fetch(`/api/tutor/messages/${reply.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!r.ok) throw new Error(t.failure);
      setMessages((old) =>
        old.map((m) =>
          m.reply?.id === reply.id
            ? { ...m, reply: { ...reply, feedback: value } }
            : m,
        ),
      );
    } catch {
      setError(t.feedbackError);
    }
  }
  return (
    <section
      ref={root}
      id="lesson-tutor"
      className="mt-10 min-w-0 scroll-mt-24 rounded-2xl border border-emerald-900/15 bg-white p-5 sm:p-7"
      aria-label={t.title}
    >
      <h2 className="text-2xl font-semibold">{t.title}</h2>
      <p className="mt-3 text-sm leading-7 text-stone-600">{t.description}</p>
      {mock && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-950">
          {t.mock}
        </p>
      )}
      {!messages.length && (
        <p className="mt-5 text-sm leading-7 text-stone-500">{t.empty}</p>
      )}
      <div className="mt-5 space-y-5" aria-label={t.currentDialog}>
        {messages.map((m) => (
          <article
            key={m.key}
            className={`min-w-0 rounded-xl p-4 ${m.role === "user" ? "bg-stone-100" : "border border-emerald-100 bg-emerald-50/40"}`}
            aria-label={m.role === "user" ? t.questionLabel : t.answerLabel}
          >
            <p className="mb-2 text-xs font-semibold text-stone-500">
              {m.role === "user" ? t.you : t.assistant}
            </p>
            {m.reply ? (
              <AnswerText reply={m.reply} />
            ) : (
              <p className="whitespace-pre-wrap break-words leading-8">
                {m.content || t.pending}
              </p>
            )}
            {m.reply && (
              <>
                {m.reply.citations.length > 0 && (
                  <div className="mt-4 border-t border-emerald-100 pt-3">
                    <p className="text-xs font-semibold">{t.sources}</p>
                    <ul className="mt-2 space-y-2">
                      {m.reply.citations.map((c) => (
                        <li key={c.n}>
                          <a
                            href={c.href}
                            className="inline-block min-h-11 text-sm leading-7 text-emerald-800 underline"
                          >
                            [{c.n}] {c.topicTitle}
                            {c.heading ? ` → ${c.heading}` : ""}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  {([1, -1] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={m.reply!.feedback === value}
                      onClick={() => void feedback(m.reply!, value)}
                      className="min-h-11 rounded-lg border border-emerald-200 px-3 text-xs text-emerald-900 aria-pressed:bg-emerald-100"
                    >
                      {value === 1 ? t.useful : t.inaccurate}
                    </button>
                  ))}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm leading-7 text-red-900"
        >
          <p>{error}</p>
          {retry && (
            <button
              type="button"
              disabled={busy || quota?.remaining === 0}
              onClick={() => void send(retry)}
              className="min-h-11 underline"
            >
              {t.retry}
            </button>
          )}
        </div>
      )}
      {quota?.remaining === 0 && (
        <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm leading-7">
          <p>
            {t.exhausted}
            {quota.resetAt
              ? t.reset(
                  new Intl.DateTimeFormat("ru-RU", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: quota.timeZone,
                  }).format(new Date(quota.resetAt)),
                )
              : ""}
          </p>
          {quota.tier !== "paid" && (
            <Link
              className="inline-flex min-h-11 items-center text-emerald-800 underline"
              href={quota.tier === "guest" ? "/login" : "/subjects"}
            >
              {quota.tier === "guest" ? t.login : t.getAccess}
            </Link>
          )}
        </div>
      )}
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim())
            void send({
              kind: "question",
              text: text.trim(),
              topicId,
              subjectId,
              requestId: crypto.randomUUID(),
            });
        }}
      >
        <label className="block text-sm font-medium">
          {t.yourQuestion}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy || quota?.remaining === 0}
            maxLength={1000}
            rows={3}
            placeholder={t.placeholder}
            className="mt-2 block w-full rounded-lg border border-stone-300 p-3 text-sm leading-7 disabled:bg-stone-50"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-stone-500" aria-live="polite">
            {quota ? t.remaining(quota.remaining) : t.checking}
          </p>
          <button
            type="submit"
            disabled={busy || !text.trim() || quota?.remaining === 0}
            className="lesson-primary"
          >
            {busy ? t.pending : t.ask}
          </button>
        </div>
      </form>
      <p className="mt-5 text-xs leading-6 text-stone-500">{t.disclaimer}</p>
    </section>
  );
}
