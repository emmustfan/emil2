import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { contentRu as t, ru, rolesRu, authRu } from "@/lib/i18n/ru";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireEditor();
  const home = user.role === "ADMIN" ? "/admin" : "/teacher";
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-5 border-b border-emerald-900/10 py-6">
        <Link href={home} className="font-semibold text-emerald-900">
          {ru.brand} · {rolesRu.roles[user.role]}
        </Link>
        <nav
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
          aria-label={t.title}
        >
          <Link
            className="inline-flex min-h-11 items-center text-emerald-800 underline"
            href={home}
          >
            {t.subjects}
          </Link>
          {user.role === "ADMIN" && (
            <Link
              href="/admin/users"
              className="inline-flex min-h-11 items-center text-emerald-800 underline"
            >
              {rolesRu.users}
            </Link>
          )}
          {user.role === "ADMIN" && (
            <Link
              href="/admin/payments"
              className="inline-flex min-h-11 items-center text-emerald-800 underline"
            >
              Платежи
            </Link>
          )}
          <Link
            className="inline-flex min-h-11 items-center text-emerald-800 underline"
            href="/student"
          >
            {rolesRu.myLearning}
          </Link>
          <Link
            href="/cabinet/profile"
            className="inline-flex min-h-11 items-center text-emerald-800 underline"
          >
            {rolesRu.profile}
          </Link>
          <form method="POST" action="/api/auth/logout">
            <button className="min-h-11 underline">{authRu.logout}</button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
