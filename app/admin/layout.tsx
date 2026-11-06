import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { contentRu as t, ru } from "@/lib/i18n/ru";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireEditor();
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-5 border-b border-emerald-900/10 py-6">
        <Link href="/admin" className="font-semibold text-emerald-900">
          {ru.brand} · {t.title}
        </Link>
        <nav className="flex gap-6 text-sm" aria-label={t.title}>
          <Link
            className="inline-flex min-h-11 items-center text-emerald-800 underline"
            href="/admin"
          >
            {t.subjects}
          </Link>
          <Link
            className="inline-flex min-h-11 items-center text-emerald-800 underline"
            href="/cabinet"
          >
            {t.cabinet}
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
