"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function RefundButton({ paymentId }: { paymentId: string }) {
  const router = useRouter(),
    [confirm, setConfirm] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function refund() {
    setPending(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/payments/${paymentId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      router.refresh();
      setConfirm(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось подтвердить возврат.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-4">
      {error && <p role="alert">{error}</p>}
      {confirm ? (
        <>
          <p className="mb-3 text-sm leading-7">
            Вернуть всю сумму? После подтверждения платёжным сервисом подписка
            будет закрыта полностью, включая доступ по её продлениям.
          </p>
          <button
            disabled={pending}
            onClick={refund}
            className="lesson-primary"
          >
            Подтвердить полный возврат
          </button>
          <button
            disabled={pending}
            onClick={() => setConfirm(false)}
            className="ml-4 min-h-11 underline"
          >
            Назад
          </button>
        </>
      ) : (
        <button
          className="min-h-11 text-emerald-800 underline"
          onClick={() => setConfirm(true)}
        >
          Вернуть деньги
        </button>
      )}
    </div>
  );
}
