"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { metrikaGoal } from "../landing/consent";
type Plan = {
  code: string;
  title: string;
  kind: string;
  priceKopecks: number;
  periodMonths: number;
  features: string[];
};
export function Checkout({
  plans,
  subjects,
  initialPlan,
  initialSubject,
  email,
  signedIn,
  renewal,
  version,
  offerVersion,
  mock,
  notice,
}: {
  plans: Plan[];
  subjects: { id: string; title: string }[];
  initialPlan?: string;
  initialSubject?: string;
  email: string;
  signedIn: boolean;
  renewal: string;
  version: string;
  offerVersion: string;
  mock: boolean;
  notice: string;
}) {
  const [code, setCode] = useState(
      plans.find((p) => p.code === initialPlan)?.code ?? plans[0]?.code ?? "",
    ),
    [subject, setSubject] = useState(initialSubject ?? ""),
    [buyerEmail, setEmail] = useState(email),
    [agreed, setAgreed] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef<string | null>(null),
    active = useRef(false);
  const plan = plans.find((p) => p.code === code);
  if (!plan)
    return (
      <p>
        Платные тарифы пока не настроены.{" "}
        <Link href="/subjects" className="underline">
          К бесплатным темам
        </Link>
      </p>
    );
  const next = `/pricing?plan=${encodeURIComponent(code)}${plan.kind === "SUBJECT" && subject ? `&subject=${encodeURIComponent(subject)}` : ""}`;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (active.current || !agreed || !plan) return;
    active.current = true;
    setPending(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: requestId.current,
          planCode: code,
          ...(plan.kind === "SUBJECT" ? { subjectId: subject } : {}),
          buyerEmail,
          amountKopecks: plan.priceKopecks,
          periodMonths: plan.periodMonths,
          renewalConsent: agreed,
          renewalConsentVersion: version,
          offerVersion,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      metrikaGoal("checkout_started");
      window.location.assign(
        data.confirmationUrl ?? `/checkout/return?paymentId=${data.id}`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось начать оплату. Повторите попытку.",
      );
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-8 max-w-3xl space-y-6">
      {mock && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm leading-7">
          {notice}
        </p>
      )}
      <fieldset disabled={pending}>
        <legend className="mb-3 text-lg font-semibold">Выберите тариф</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((p) => (
            <label
              key={p.code}
              className={`cursor-pointer rounded-2xl border bg-white p-5 ${p.code === code ? "border-emerald-700" : "border-stone-200"}`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="plan"
                  value={p.code}
                  checked={p.code === code}
                  onChange={() => {
                    setCode(p.code);
                    setAgreed(false);
                    requestId.current = null;
                  }}
                />
                <strong>{p.title}</strong>
              </span>
              <span className="mt-4 block text-lg">
                {formatPrice(p.priceKopecks)} / {p.periodMonths} мес.
              </span>
              <span className="mt-3 block text-sm leading-7 text-stone-600">
                {p.features.join(" · ")}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {plan.kind === "SUBJECT" && (
        <label className="block text-sm font-medium">
          Предмет
          <select
            required
            value={subject}
            disabled={pending}
            onChange={(e) => {
              setSubject(e.target.value);
              setAgreed(false);
              requestId.current = null;
            }}
            className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white p-3"
          >
            <option value="">Выберите предмет</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {!signedIn ? (
        <div>
          <p className="mb-4 text-sm">
            Войдите, чтобы оформить выбранный тариф и сохранить доступ в своём
            аккаунте.
          </p>
          <Link
            className="lesson-primary"
            href={`/login?next=${encodeURIComponent(next)}`}
          >
            Войти и продолжить оформление
          </Link>
        </div>
      ) : (
        <>
          <label className="block text-sm font-medium">
            Почта для чеков и уведомлений
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              disabled={pending}
              value={buyerEmail}
              onChange={(e) => {
                setEmail(e.target.value);
                requestId.current = null;
              }}
              className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white p-3"
            />
          </label>
          <p className="text-sm leading-7">
            Сейчас:{" "}
            <strong>
              {formatPrice(plan.priceKopecks)} за {plan.periodMonths} мес.
            </strong>{" "}
            Затем та же сумма раз в {plan.periodMonths} мес. Дата следующего
            списания будет указана в кабинете.
          </p>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm leading-7">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0"
              checked={agreed}
              disabled={pending}
              onChange={(e) => setAgreed(e.target.checked)}
              required
            />
            <span>
              {renewal}{" "}
              <Link href="/legal/oferta" className="underline">
                Оферта
              </Link>{" "}
              ·{" "}
              <Link href="/legal/refund" className="underline">
                Возврат
              </Link>
              .
            </span>
          </label>
          {error && (
            <p role="alert" className="text-red-800">
              {error}{" "}
              <Link href="/cabinet/subscription" className="underline">
                Проверить подписки и незавершённую оплату
              </Link>
            </p>
          )}
          <button
            className="lesson-primary"
            disabled={
              pending || !agreed || (plan.kind === "SUBJECT" && !subject)
            }
          >
            {pending
              ? "Готовим оплату…"
              : `${mock ? "Тестовая оплата" : "Оплатить"} · ${formatPrice(plan.priceKopecks)}`}
          </button>
        </>
      )}
    </form>
  );
}
