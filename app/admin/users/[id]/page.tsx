import Link from "next/link";
import { requireAdmin } from "@/lib/auth/server";
import { getManagedUser } from "@/lib/admin/users";
import { contentPage } from "@/lib/content/page";
import { UserAccessForm } from "@/components/admin/user-access-form";
import { rolesRu as t } from "@/lib/i18n/ru";
import { dayWindow } from "@/lib/srs/day";
import { getDb } from "@/lib/db";
import { GrantForm, RevokeGrant } from "@/components/admin/grants";
import { formatPrice } from "@/lib/format";
import { getSetting } from "@/lib/settings";
export default async function UserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAdmin(),
    { id } = await params,
    data = await contentPage(() => getManagedUser(actor.id, id));
  const [grants, subs, activity, defaultDays, maxDays] = await Promise.all([
    getDb().accessGrant.findMany({
      where: { userId: id },
      include: { subject: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getDb().subscription.findMany({
      where: { userId: id },
      include: {
        plan: { select: { title: true } },
        subject: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getDb().event.findMany({
      where: {
        userId: id,
        name: {
          in: [
            "gap_answered",
            "test_completed",
            "review_session_completed",
            "tutor_message_sent",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, createdAt: true },
    }),
    getSetting("admin.defaultGrantDays"),
    getSetting("admin.maxGrantDays"),
  ]);
  return (
    <main className="mx-auto max-w-3xl">
      <Link
        href="/admin/users"
        className="inline-flex min-h-11 items-center text-sm text-emerald-800 underline"
      >
        ← {t.backUsers}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold break-words">
        {data.user.name || data.user.email || t.identity}
      </h1>
      <UserAccessForm
        timeZone={dayWindow(new Date(), actor.timezone).timeZone}
        key={data.user.id}
        initial={data}
        actorId={actor.id}
      />
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Ручная выдача доступа</h2>
        {!data.user.blockedAt && (
          <GrantForm
            userId={id}
            subjects={data.subjects}
            defaultDays={defaultDays}
            maxDays={maxDays}
          />
        )}
        <ul className="mt-5 space-y-3">
          {grants.map((g) => (
            <li key={g.id} className="rounded-xl border p-4">
              <p>
                {g.subject?.title ?? "Все предметы"} · до{" "}
                {g.expiresAt.toISOString().slice(0, 10)}
              </p>
              <p className="mt-2 text-sm">{g.reason}</p>
              {g.expiresAt > new Date() && (
                <RevokeGrant id={g.id} userId={id} />
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Подписки пользователя</h2>
        {subs.map((s) => (
          <p key={s.id} className="mt-3 rounded-xl border p-4 text-sm">
            {s.plan.title} · {s.subject?.title ?? "Все предметы"} ·{" "}
            {formatPrice(s.priceKopecks)} ·{" "}
            {
              {
                ACTIVE: "Активна",
                PAST_DUE: "Не удалось продлить",
                EXPIRED: "Завершена",
              }[s.status]
            }{" "}
            · оплачено до {s.currentPeriodEnd.toISOString().slice(0, 10)}
          </p>
        ))}
        {!subs.length && <p className="mt-3 text-sm">Подписок нет.</p>}
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Последняя учебная активность</h2>
        {activity.map((a) => (
          <p key={a.id.toString()} className="mt-3 text-sm">
            {
              {
                gap_answered: "Ответ на задание",
                test_completed: "Завершён тест",
                review_session_completed: "Повторение",
                tutor_message_sent: "Вопрос тьютору",
              }[a.name]
            }{" "}
            · {a.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
        ))}
        {!activity.length && (
          <p className="mt-3 text-sm">Учебной активности пока нет.</p>
        )}
      </section>
    </main>
  );
}
