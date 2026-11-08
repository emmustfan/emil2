"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function CancelRenewal({ id }: { id: string }) {
  const router = useRouter(),
    [confirm, setConfirm] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function cancel() {
    if (pending) return;
    setPending(true);
    try {
      const r = await fetch(`/api/subscriptions/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      router.refresh();
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Попробуйте снова.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-4">
      {error && <p role="alert">{error}</p>}
      {confirm ? (
        <div className="rounded-xl border border-stone-200 p-4">
          <p className="mb-4 text-sm">
            Отключить следующие списания? Доступ сохранится до конца оплаченного
            срока. Уже начатую оплату можно проверить отдельно ниже.
          </p>
          <button
            className="lesson-primary"
            disabled={pending}
            onClick={cancel}
          >
            Подтвердить отключение
          </button>
          <button
            className="ml-4 min-h-11 underline"
            disabled={pending}
            onClick={() => setConfirm(false)}
          >
            Оставить продление
          </button>
        </div>
      ) : (
        <button
          className="min-h-11 text-emerald-800 underline"
          onClick={() => setConfirm(true)}
        >
          Отключить автопродление
        </button>
      )}
    </div>
  );
}
