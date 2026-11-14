"use client";
import { useState } from "react";
import { formatPrice } from "@/lib/format";
import { useClientReady } from "@/lib/use-client-ready";
export function MockPayment({
  id,
  title,
  amount,
}: {
  id: string;
  title: string;
  amount: number;
}) {
  const ready = useClientReady();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function settle(status: "succeeded" | "canceled") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const r = await fetch(`/api/dev/mock-pay/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      window.location.assign(data.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Попробуйте снова.");
      setPending(false);
    }
  }
  return (
    <section className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold">Тестовая оплата</h1>
      <p className="rounded-xl bg-amber-50 p-5 text-sm leading-7">
        Это имитация платежа. Реальные деньги не списываются, банковская карта и
        её данные не нужны.
      </p>
      <p className="text-xl">
        {title} · {formatPrice(amount)}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-4">
        <button
          className="lesson-primary"
          disabled={pending || !ready}
          onClick={() => settle("succeeded")}
        >
          Оплатить в тестовом режиме
        </button>
        <button
          className="min-h-11 underline"
          disabled={pending || !ready}
          onClick={() => settle("canceled")}
        >
          Отклонить тестовый платёж
        </button>
      </div>
    </section>
  );
}
