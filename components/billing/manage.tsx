"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ManageSubscription({
  id,
  action,
  renewal,
  version,
  offerVersion,
}: {
  id: string;
  action: "resume" | "unlink" | "pay";
  renewal?: string;
  version?: string;
  offerVersion?: string;
}) {
  const router = useRouter(),
    [open, setOpen] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const label = {
    resume: "Возобновить автопродление",
    unlink: "Отвязать карту",
    pay: "Оплатить вручную",
  }[action];
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/subscriptions/${id}/manage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            data:
              action === "resume"
                ? {
                    confirm: true,
                    renewalConsent: consent,
                    renewalConsentVersion: version,
                    offerVersion,
                  }
                : { confirm: true },
          }),
        }),
        data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (action === "pay")
        location.assign(
          data.confirmationUrl ?? `/checkout/return?paymentId=${data.id}`,
        );
      else {
        setOpen(false);
        setConsent(false);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3">
      {error && (
        <p role="alert" className="my-3 text-sm">
          {error}
        </p>
      )}
      {!open ? (
        <button
          className="min-h-11 text-sm text-emerald-800 underline"
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      ) : (
        <div className="rounded-xl border p-4">
          <p className="text-sm leading-7">
            {action === "unlink"
              ? "Сохранённая карта будет удалена из платформы, будущие автосписания отключатся. Оплаченный доступ сохраняется; уже начатое списание проверяется отдельно."
              : action === "resume"
                ? "Автосписания возобновятся по указанной выше сумме и дате. Если дата уже близко, попытка может начаться в ближайший час."
                : "Откроется форма оплаты на сумму текущего продления. Пока она ожидает результат, автоматическая попытка не создаётся."}
          </p>
          {action === "resume" && (
            <label className="my-4 flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {renewal}
            </label>
          )}
          <button
            className="lesson-primary mt-3"
            disabled={busy || (action === "resume" && !consent)}
            onClick={submit}
          >
            Подтвердить: {label.toLowerCase()}
          </button>
          <button
            className="ml-4 min-h-11 underline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Отмена
          </button>
        </div>
      )}
    </div>
  );
}
