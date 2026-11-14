import Link from "next/link";
import { requireAdmin } from "@/lib/auth/server";
import { listUsers, userFilters, roleValues } from "@/lib/admin/users";
import { Pagination } from "@/components/admin/pagination";
import { rolesRu as t } from "@/lib/i18n/ru";
export default async function Users({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin(),
    raw = await searchParams,
    parsed = userFilters.safeParse({
      q: raw.q ?? "",
      page: raw.page ?? 1,
      role: raw.role ?? "ALL",
      state: raw.state ?? "ALL",
    }),
    filters = parsed.success ? parsed.data : userFilters.parse({}),
    data = await listUsers(actor.id, filters);
  return (
    <main>
      <h1 className="text-3xl font-semibold">{t.users}</h1>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-600">
        {t.usersDescription}
      </p>
      <form className="my-7 flex flex-wrap gap-3" role="search">
        <input
          name="q"
          aria-label={t.searchPlaceholder}
          placeholder={t.searchPlaceholder}
          defaultValue={filters.q}
          maxLength={200}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-stone-300 px-3"
        />
        <select
          name="role"
          aria-label={t.role}
          defaultValue={filters.role}
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3"
        >
          <option value="ALL">{t.allRoles}</option>
          {roleValues.map((role) => (
            <option key={role} value={role}>
              {t.roles[role]}
            </option>
          ))}
        </select>
        <select
          name="state"
          aria-label={t.status}
          defaultValue={filters.state}
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3"
        >
          <option value="ALL">{t.allStates}</option>
          <option value="ACTIVE">{t.active}</option>
          <option value="BLOCKED">{t.blocked}</option>
        </select>
        <button className="lesson-primary">{t.search}</button>
      </form>
      <div className="space-y-3">
        {data.items.map((u) => (
          <article
            key={u.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/admin/users/${u.id}`}
                className="font-semibold break-words text-emerald-900 underline"
              >
                {u.name || u.email || u.telegramUsername || t.identity}
              </Link>
              <p className="mt-2 text-xs leading-6 break-all text-stone-500">
                {u.email ??
                  (u.telegramUsername
                    ? `@${u.telegramUsername}`
                    : (u.telegramId ?? "—"))}
              </p>
            </div>
            <p className="text-sm">{t.roles[u.role]}</p>
            <span
              className={`rounded-full px-3 py-1 text-xs ${u.blockedAt ? "bg-red-50 text-red-900" : "bg-emerald-50 text-emerald-900"}`}
            >
              {u.blockedAt ? t.blocked : t.active}
            </span>
            <Link
              href={`/admin/users/${u.id}`}
              className="inline-flex min-h-11 items-center text-sm text-emerald-800 underline"
            >
              {t.editAccess}
            </Link>
          </article>
        ))}
      </div>
      {!data.items.length && (
        <p className="py-8 text-stone-500">{t.emptyUsers}</p>
      )}
      <Pagination
        base="/admin/users"
        q={filters.q}
        {...data}
        filters={{ role: filters.role, state: filters.state }}
      />
    </main>
  );
}
