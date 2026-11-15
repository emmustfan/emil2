import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/server";
import { dayWindow } from "@/lib/srs/day";
import { getSetting } from "@/lib/settings";
export async function ImpersonationHistory({ userId }: { userId: string }) {
  const viewer = await requireAdmin(),
    now = new Date(),
    db = getDb();
  const rows = await db.impersonationSession.findMany({
    where: { targetUserId: userId },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: await getSetting("admin.impersonationHistoryLimit"),
  });
  const admins = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.adminId))] } },
    select: { id: true, name: true, email: true, deletedAt: true },
  });
  const format = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: dayWindow(now, viewer.timezone).timeZone,
  });
  return (
    <section className="mt-8" aria-label="Просмотры администратором">
      <h2 className="text-xl font-semibold">Просмотры администратором</h2>
      {!rows.length && <p className="mt-3 text-sm">Просмотров пока нет.</p>}
      <ul className="mt-4 space-y-3">
        {rows.map((row) => {
          const admin = admins.find((a) => a.id === row.adminId),
            finish = row.endedAt ?? new Date(Math.min(+now, +row.expiresAt)),
            seconds = Math.max(
              0,
              Math.floor((+finish - +row.startedAt) / 1000),
            );
          return (
            <li
              key={row.id}
              className="rounded-xl border bg-white p-4 break-words"
            >
              <p className="font-semibold">
                {admin && !admin.deletedAt
                  ? admin.name || admin.email || "Администратор"
                  : "Удалённый администратор"}
              </p>
              <p className="mt-2 text-sm">
                {format.format(row.startedAt)} · {seconds} сек. ·{" "}
                {{
                  exit: "Выход из режима",
                  expired: "Срок истёк",
                  admin_logout: "Выход администратора из аккаунта",
                  admin_revoked: "Доступ отозван",
                }[row.endedReason ?? ""] ??
                  (row.expiresAt > now ? "Просмотр активен" : "Срок истёк")}
              </p>
              <p className="mt-2 whitespace-pre-wrap">Причина: {row.reason}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
