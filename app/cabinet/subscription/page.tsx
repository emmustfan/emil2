import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { billingConfig, billingContent } from "@/lib/billing/config";
import { chargeAt } from "@/lib/billing/policy";
import { formatPrice } from "@/lib/lessons/catalog";
import { CancelRenewal } from "@/components/billing/cancel";
import { AuthShell } from "@/components/auth/shell";
import { currentLegal } from "@/lib/auth/legal";
import { ManageSubscription } from "@/components/billing/manage";
export const dynamic = "force-dynamic";
export default async function Subscription() {
  const user = await requireUser(),
    [subs, pending, cfg, text, legal] = await Promise.all([
      getDb().subscription.findMany({
        where: { userId: user.id },
        include: { plan: true, subject: { select: { title: true } } },
        orderBy: { createdAt: "desc" },
      }),
      getDb().payment.findMany({
        where: { userId: user.id, status: "PENDING" },
        select: { id: true, planTitle: true, amountKopecks: true },
        orderBy: { createdAt: "desc" },
      }),
      billingConfig(),
      billingContent(),
      currentLegal(),
    ]);
  const date = (value: Date) =>
    new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: user.timezone,
    }).format(value);
  return (
    <AuthShell
      title="Подписка и доступ"
      description="Оплаченный срок и следующие списания"
    >
      <Link className="lesson-primary" href="/pricing">
        Посмотреть тарифы
      </Link>
      {(getEnv().PAYMENTS_PROVIDER === "mock" ||
        getEnv().YOOKASSA_TEST_MODE) && (
        <p className="my-5 rounded-xl bg-amber-50 p-4 text-sm leading-7">
          {getEnv().PAYMENTS_PROVIDER === "mock"
            ? text.mockNotice
            : text.testShopNotice}
        </p>
      )}
      {!subs.length && (
        <p className="my-6">
          Подписок пока нет. Бесплатные темы доступны в каталоге.
        </p>
      )}
      <div className="mt-6 space-y-5">
        {subs.map((s) => (
          <article
            key={s.id}
            className="rounded-2xl border border-stone-200 bg-white p-5"
          >
            <h2 className="text-xl font-semibold">
              {s.plan.title}
              {s.subject ? ` · ${s.subject.title}` : ""}
            </h2>
            <p className="mt-3 text-sm">
              {
                {
                  ACTIVE: "Активна",
                  PAST_DUE: "Не удалось продлить",
                  EXPIRED: "Завершена",
                }[s.status]
              }{" "}
              · {formatPrice(s.priceKopecks)} / {s.periodMonths} мес.
            </p>
            <p className="mt-3 text-sm">
              Оплачено до: {date(s.currentPeriodEnd)}
            </p>
            {s.paymentMethodTitle && (
              <p className="mt-3 text-sm">{s.paymentMethodTitle}</p>
            )}
            {s.status === "PAST_DUE" && (
              <div>
                <p className="mt-3 text-sm">
                  Платёж не прошёл.
                  {s.nextRetryAt
                    ? ` Следующая попытка: ${date(s.nextRetryAt)}.`
                    : ""}{" "}
                  Доступ зависит от оплаченного срока и льготного периода.
                </p>
                <ManageSubscription id={s.id} action="pay" />
              </div>
            )}
            {!s.autoRenew &&
              s.status === "ACTIVE" &&
              s.currentPeriodEnd > new Date() &&
              !s.revokedAt &&
              s.paymentMethodId && (
                <ManageSubscription
                  id={s.id}
                  action="resume"
                  renewal={text.renewal}
                  version={text.version}
                  offerVersion={legal.offer.version}
                />
              )}
            {s.paymentMethodId && (
              <ManageSubscription id={s.id} action="unlink" />
            )}
            {s.autoRenew && s.status !== "EXPIRED" ? (
              <>
                <p className="mt-3 text-sm">
                  Следующее списание:{" "}
                  {date(
                    s.nextRetryAt ??
                      chargeAt(s.currentPeriodEnd, cfg.leadHours),
                  )}
                  , {formatPrice(s.priceKopecks)}.
                </p>
                <CancelRenewal id={s.id} />
              </>
            ) : (
              <p className="mt-3 text-sm">
                Автопродление отключено.
                {s.revokedAt
                  ? " Возврат закрывает доступ сразу."
                  : " Доступ сохраняется до конца оплаченного срока."}
              </p>
            )}
          </article>
        ))}
      </div>
      {pending.length > 0 && (
        <section className="mt-7">
          <h2 className="text-xl font-semibold">Незавершённая оплата</h2>
          {pending.map((p) => (
            <p key={p.id} className="mt-3 text-sm">
              <Link
                href={`/checkout/return?paymentId=${p.id}`}
                className="inline-flex min-h-11 items-center underline"
              >
                {p.planTitle} · {formatPrice(p.amountKopecks)} — проверить
              </Link>
            </p>
          ))}
        </section>
      )}
      <p className="mt-7 text-sm">
        <Link href="/legal/refund" className="underline">
          Правила возврата
        </Link>
        {getEnv().SUPPORT_EMAIL && (
          <>
            {" "}
            ·{" "}
            <a href={`mailto:${getEnv().SUPPORT_EMAIL}`} className="underline">
              Поддержка
            </a>
          </>
        )}
      </p>
    </AuthShell>
  );
}
