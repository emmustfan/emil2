"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { metrikaGoal } from "../landing/consent";
type Status = {
  id: string;
  status: string;
  title: string;
  amountKopecks: number;
  confirmationUrl: string | null;
  cancellationMessage: string | null;
  refundPending: boolean;
  refundRevokesAccess: boolean;
  href: string;
};
export function PaymentReturn({
  initial,
  timeoutSeconds,
}: {
  initial: Status;
  timeoutSeconds: number;
}) {
  const [status, setStatus] = useState(initial),
    [expired, setExpired] = useState(false),
    [error, setError] = useState("");
  const goal = useRef(false);
  useEffect(() => {
    if (
      status.status === "SUCCEEDED" &&
      !status.refundPending &&
      !goal.current
    ) {
      goal.current = true;
      metrikaGoal("payment_succeeded");
    }
  }, [status.status, status.refundPending]);
  useEffect(() => {
    if (initial.status !== "PENDING" && !initial.refundPending) return;
    let stopped = false;
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (Date.now() - start >= timeoutSeconds * 1000) {
        setExpired(true);
        return;
      }
      try {
        const r = await fetch(`/api/checkout/${initial.id}`, {
          cache: "no-store",
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (stopped) return;
        setStatus(data);
        setError("");
        if (data.status !== "PENDING" && !data.refundPending) return;
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Не удалось уточнить оплату.",
          );
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    }
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [initial.id, initial.status, initial.refundPending, timeoutSeconds]);
  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="text-3xl font-semibold">
        {status.refundPending
          ? "Проверяем возврат"
          : status.status === "SUCCEEDED"
            ? "Доступ открыт"
            : status.status === "CANCELED"
              ? "Оплата отменена"
              : status.status === "REFUNDED"
                ? "Возврат выполнен"
                : "Проверяем оплату"}
      </h1>
      <p>
        {status.title} · {formatPrice(status.amountKopecks)}
      </p>
      {error && <p role="alert">{error}</p>}
      {status.refundPending ? (
        <p>
          Платёж поступил после закрытия подписки. Проверяем возврат; доступ
          пока закрыт.
        </p>
      ) : status.status === "SUCCEEDED" ? (
        <>
          <p>Оплата подтверждена. Подписка и её срок видны в вашем кабинете.</p>
          <Link className="lesson-primary" href={status.href}>
            Перейти к обучению
          </Link>
        </>
      ) : status.status === "CANCELED" ? (
        <>
          <p>{status.cancellationMessage}</p>
          <Link className="lesson-primary" href="/pricing">
            Попробовать снова
          </Link>
        </>
      ) : status.status === "REFUNDED" ? (
        <p>
          {status.refundRevokesAccess
            ? "Платёж возвращён, подписка закрыта. Бесплатные темы остаются доступны."
            : "Этот платёж возвращён. Срок действующей подписки можно проверить в кабинете."}
        </p>
      ) : (
        <>
          <p>
            {expired
              ? "Подтверждение пока не получено. Проверить состояние можно позже в кабинете; повторно оплачивать сейчас не нужно."
              : "Ожидаем подтверждение платёжного сервиса."}
          </p>
          {status.confirmationUrl && (
            <a className="lesson-primary" href={status.confirmationUrl}>
              Вернуться к оплате
            </a>
          )}
        </>
      )}
      <p>
        <Link href="/cabinet/subscription" className="underline">
          Управление подпиской
        </Link>
      </p>
    </section>
  );
}
