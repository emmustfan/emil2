import { requireAdmin } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { RefundButton } from "@/components/billing/refund";
import { formatPrice } from "@/lib/lessons/catalog";
import Link from "next/link";
import { reportRange, reportInput } from "@/lib/admin/policy";
import { getSetting } from "@/lib/settings";
export const dynamic = "force-dynamic";
export default async function AdminPayments({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    page?: string;
    from?: string;
    to?: string;
  }>;
}) {
  await requireAdmin();
  const p = await searchParams,
    status = ["PENDING", "SUCCEEDED", "CANCELED", "REFUNDED"].includes(
      p.status ?? "",
    )
      ? (p.status as "PENDING" | "SUCCEEDED" | "CANCELED" | "REFUNDED")
      : undefined,
    page = Math.max(1, Math.min(10000, Number.parseInt(p.page ?? "1") || 1));
  let range: ReturnType<typeof reportRange>;
  try {
    range = reportRange(
      reportInput.parse({ from: p.from || undefined, to: p.to || undefined }),
    );
  } catch {
    return (
      <main>
        <h1>Платежи и возвраты</h1>
        <p role="alert">Проверьте даты.</p>
        <Link href="/admin/payments">Сбросить фильтры</Link>
      </main>
    );
  }
  const size = await getSetting("admin.usersPageSize");
  const payments = await getDb().payment.findMany({
    where: {
      createdAt: { gte: range.start, lt: range.end },
      ...(status ? { status } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * size,
    take: size + 1,
    include: {
      refund: { select: { status: true } },
      user: { select: { email: true, name: true, deletedAt: true } },
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
        <label className="text-sm">
          С даты оформления (UTC)
          <input
            className="ml-3 min-h-11 rounded-lg border bg-white p-2"
            type="date"
            name="from"
            defaultValue={range.from}
          />
        </label>
        <label className="text-sm">
          По дату (UTC)
          <input
            className="ml-3 min-h-11 rounded-lg border bg-white p-2"
            type="date"
            name="to"
            defaultValue={range.to}
          />
        </label>
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
        {payments.slice(0, size).map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-stone-200 bg-white p-5"
          >
            <h2 className="font-semibold">
              {p.planTitle || "Платёж"} · {formatPrice(p.amountKopecks)}
            </h2>
            <p className="mt-2 text-sm">
              {p.user.deletedAt
                ? "Удалённый аккаунт"
                : `${p.user.name ?? "Пользователь"} · ${p.user.email ?? "Вход через Telegram"}`}
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
            <p className="mt-2 text-xs text-stone-500">
              Оформлен{" "}
              {p.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
            </p>
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
            href={`/admin/payments?${new URLSearchParams({ page: String(page - 1), status: status ?? "", from: range.from, to: range.to })}`}
          >
            Назад
          </Link>
        )}
        {payments.length > size && (
          <Link
            className="min-h-11 underline"
            href={`/admin/payments?${new URLSearchParams({ page: String(page + 1), status: status ?? "", from: range.from, to: range.to })}`}
          >
            Дальше
          </Link>
        )}
      </nav>
    </main>
  );
}
