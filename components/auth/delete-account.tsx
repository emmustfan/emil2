"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/profile/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: confirmation }),
        }),
        data = await r.json();
      if (!r.ok) throw new Error(data.error);
      try {
        localStorage.removeItem("signup-goal-pending");
        sessionStorage.removeItem("pending-analytics-goals");
      } catch {
        /* Optional browser storage. */
      }
      router.replace("/login?deleted=1");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить аккаунт.");
      setBusy(false);
    }
  }
  return (
    <section className="mt-10 border-t border-stone-200 pt-7">
      <h2 className="text-xl font-semibold">Удаление аккаунта</h2>
      <p className="my-4 text-sm leading-7">
        Вход и автопродление отключатся сразу. Учебные данные и персональные
        сведения будут удалены или обезличены фоновым процессом не позднее 30
        дней. Обезличенные записи об оплате сохраняются для учёта. Удаление не
        выполняет возврат денег.
      </p>
      {open ? (
        <div className="rounded-xl border border-red-200 p-4">
          <p className="text-sm leading-7">
            Это действие нельзя отменить. Для подтверждения введите УДАЛИТЬ.
          </p>
          <label className="mt-3 block text-sm">
            Подтверждение удаления
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border p-3"
              autoComplete="off"
            />
          </label>
          {error && (
            <p role="alert" className="my-3">
              {error}
            </p>
          )}
          <button
            className="lesson-primary mt-4"
            disabled={busy || confirmation !== "УДАЛИТЬ"}
            onClick={remove}
          >
            Удалить аккаунт окончательно
          </button>
          <button
            className="ml-4 min-h-11 underline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Оставить аккаунт
          </button>
        </div>
      ) : (
        <button
          className="min-h-11 text-red-800 underline"
          onClick={() => setOpen(true)}
        >
          Удалить аккаунт
        </button>
      )}
    </section>
  );
}
