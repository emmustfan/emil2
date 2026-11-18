"use client";
import { useId, useRef, useState } from "react";
export function ImpersonateUser({ userId }: { userId: string }) {
  const dialog = useRef<HTMLDialogElement>(null),
    title = useId();
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <>
      <button
        className="lesson-primary my-4"
        onClick={() => {
          setError("");
          dialog.current?.showModal();
        }}
      >
        Посмотреть как этот пользователь
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={title}
        className="impersonation-dialog"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const reason = String(
              new FormData(event.currentTarget).get("reason") ?? "",
            ).trim();
            if (reason.length < 5) {
              setError("Укажите причину: от 5 до 500 символов.");
              return;
            }
            setPending(true);
            setError("");
            try {
              const response = await fetch("/api/admin/impersonation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetUserId: userId, reason }),
              });
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.error ?? "Не удалось включить режим просмотра.",
                );
              window.location.assign(result.redirect);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Не удалось включить режим просмотра.",
              );
              setPending(false);
            }
          }}
        >
          <h2 id={title} className="text-xl font-semibold">
            Просмотр под пользователем
          </h2>
          <p className="my-4 leading-7">
            Режим только для просмотра. Вход будет записан в журнал.
          </p>
          <label className="grid gap-2">
            Причина
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={500}
              rows={4}
              className="rounded border p-3"
            />
          </label>
          {error && (
            <p role="alert" className="mt-3 text-red-800">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="lesson-primary" disabled={pending}>
              {pending ? "Открываем…" : "Открыть режим просмотра"}
            </button>
            <button
              className="min-h-11 px-4 underline"
              type="button"
              disabled={pending}
              onClick={() => dialog.current?.close()}
            >
              Отмена
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
