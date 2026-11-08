import Link from "next/link";
import { requireAdmin } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { reportRange, reportInput } from "@/lib/admin/policy";
import { ReportFilters } from "@/components/admin/report-filters";
import { formatPrice } from "@/lib/format";
import type { SubscriptionStatus } from "@/lib/generated/prisma/client";
export const dynamic = "force-dynamic";
export default async function Subscriptions({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    status?: string;
    page?: string;
  }>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  let range: ReturnType<typeof reportRange>;
  try {
    range = reportRange(
      reportInput.parse({
        from: raw.from || undefined,
        to: raw.to || undefined,
      }),
    );
  } catch {
    return (
      <main>
        <h1>Подписки</h1>
        <p role="alert">Проверьте даты.</p>
        <Link href="/admin/subscriptions">Сбросить фильтры</Link>
      </main>
    );
  }
  const page = Math.max(
      1,
      Math.min(10000, Number.parseInt(raw.page ?? "1") || 1),
    ),
    status = ["ACTIVE", "PAST_DUE", "EXPIRED"].includes(raw.status ?? "")
      ? (raw.status as SubscriptionStatus)
      : undefined,
    size = await getSetting("admin.usersPageSize");
  const rows = await getDb().subscription.findMany({
    where: {
      createdAt: { gte: range.start, lt: range.end },
      ...(status ? { status } : {}),
    },
    include: {
      user: { select: { name: true, email: true, deletedAt: true } },
      plan: { select: { title: true } },
      subject: { select: { title: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * size,
    take: size + 1,
  });
  const href = (page: number) =>
    `/admin/subscriptions?${new URLSearchParams({ from: range.from, to: range.to, status: status ?? "", page: String(page) })}`;
  return (
    <main>
      <h1 className="text-3xl font-semibold">Подписки</h1>
      <p className="mt-4 text-sm">Период фильтрует дату оформления подписки.</p>
      <ReportFilters {...range}>
        <label className="text-sm">
          Статус
          <select
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 block min-h-11 rounded-lg border bg-white p-2"
          >
            <option value="">Все</option>
            <option value="ACTIVE">Активна</option>
            <option value="PAST_DUE">Не удалось продлить</option>
            <option value="EXPIRED">Завершена</option>
          </select>
        </label>
      </ReportFilters>
      <div className="space-y-4">
        {rows.slice(0, size).map((s) => (
          <article key={s.id} className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">
              {s.plan.title} · {s.subject?.title ?? "Все предметы"}
            </h2>
            <p className="mt-3 text-sm">
              {s.user.deletedAt ? (
                "Удалённый аккаунт"
              ) : (
                <Link className="underline" href={`/admin/users/${s.userId}`}>
                  {s.user.name ?? s.user.email ?? "Пользователь"}
                </Link>
              )}{" "}
              ·{" "}
              {
                {
                  ACTIVE: "Активна",
                  PAST_DUE: "Не удалось продлить",
                  EXPIRED: "Завершена",
                }[s.status]
              }
            </p>
            <p className="mt-3 text-sm">
              {formatPrice(s.priceKopecks)} / {s.periodMonths} мес. · оплачено
              до {s.currentPeriodEnd.toISOString().slice(0, 10)} · автопродление{" "}
              {s.autoRenew ? "включено" : "выключено"}
            </p>
          </article>
        ))}
        {!rows.length && <p>Подписок по этим фильтрам нет.</p>}
      </div>
      <nav className="mt-6 flex gap-5">
        {page > 1 && (
          <Link className="min-h-11 underline" href={href(page - 1)}>
            Назад
          </Link>
        )}
        {rows.length > size && (
          <Link className="min-h-11 underline" href={href(page + 1)}>
            Дальше
          </Link>
        )}
      </nav>
    </main>
  );
}
