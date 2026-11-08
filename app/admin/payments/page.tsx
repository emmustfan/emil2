import { requireAdmin } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { RefundButton } from "@/components/billing/refund";
import { formatPrice } from "@/lib/lessons/catalog";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function AdminPayments({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireAdmin();
  const p = await searchParams,
    status = ["PENDING", "SUCCEEDED", "CANCELED", "REFUNDED"].includes(
      p.status ?? "",
    )
      ? (p.status as "PENDING" | "SUCCEEDED" | "CANCELED" | "REFUNDED")
      : undefined,
    page = Math.max(1, Math.min(10000, Number.parseInt(p.page ?? "1") || 1));
  const payments = await getDb().payment.findMany({
    where: { ...(status ? { status } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * 20,
    take: 21,
    include: {
      refund: { select: { status: true } },
      user: { select: { email: true, name: true } },
    },
  });
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <Link href="/admin" className="underline">
        Администрирование
      </Link>
      <h1 className="mt-5 text-3xl font-semibold">Платежи и возвраты</h1>
      {(getEnv().PAYMENTS_PROVIDER === "mock" ||
        getEnv().YOOKASSA_TEST_MODE) && (
        <p className="mt-5 rounded-xl bg-amber-50 p-4">
          Тестовый режим: настоящих списаний и возвратов денег нет.
        </p>
      )}
      <form className="my-6 flex flex-wrap items-center gap-3">
        <label>
          Статус
          <select
            name="status"
            defaultValue={status ?? ""}
            className="ml-3 min-h-11 rounded-lg border bg-white p-2"
          >
            <option value="">Все</option>
            {[
              ["PENDING", "Ожидает"],
              ["SUCCEEDED", "Оплачен"],
              ["CANCELED", "Отменён"],
              ["REFUNDED", "Возвращён"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="lesson-primary">Показать</button>
      </form>
      <div className="space-y-5">
        {payments.slice(0, 20).map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-stone-200 bg-white p-5"
          >
            <h2 className="font-semibold">
              {p.planTitle || "Платёж"} · {formatPrice(p.amountKopecks)}
            </h2>
            <p className="mt-2 text-sm">
              {p.user.name ?? "Пользователь"} ·{" "}
              {p.user.email ?? "Вход через Telegram"}
            </p>
            <p className="mt-2 text-sm">
              {
                {
                  PENDING: "Ожидает",
                  SUCCEEDED: "Оплачен",
                  CANCELED: "Отменён",
                  REFUNDED: "Возвращён",
                }[p.status]
              }{" "}
              · {p.isRecurring ? "Продление" : "Первый платёж"}
            </p>
            <p className="mt-2 text-xs text-stone-500">{p.id}</p>
            {p.refund && (
              <p className="mt-2 text-sm">
                Возврат:{" "}
                {{
                  PENDING: "проверяется",
                  SUCCEEDED: "выполнен",
                  CANCELED: "не подтверждён",
                }[p.refund.status] ?? "проверяется"}
              </p>
            )}
            {p.status === "SUCCEEDED" && !p.refund && (
              <RefundButton paymentId={p.id} />
            )}
          </article>
        ))}
      </div>
      <nav className="mt-6 flex gap-5">
        {page > 1 && (
          <Link
            className="min-h-11 underline"
            href={`/admin/payments?page=${page - 1}${status ? `&status=${status}` : ""}`}
          >
            Назад
          </Link>
        )}
        {payments.length > 20 && (
          <Link
            className="min-h-11 underline"
            href={`/admin/payments?page=${page + 1}${status ? `&status=${status}` : ""}`}
          >
            Дальше
          </Link>
        )}
      </nav>
    </main>
  );
}
