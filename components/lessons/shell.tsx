import Link from "next/link";
import { BookOpen } from "lucide-react";
import { getCurrentSession } from "@/lib/auth/server";
export async function LearningShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-950/10 py-5">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-3 text-sm font-semibold"
        >
          <span className="rounded-xl bg-emerald-900 p-2.5 text-white">
            <BookOpen size={20} aria-hidden />
          </span>
          Учебная платформа
        </Link>
        <nav
          className="flex items-center gap-5 text-sm"
          aria-label="Основная навигация"
        >
          <Link className="inline-flex min-h-11 items-center" href="/subjects">
            Предметы
          </Link>
          <Link
            className="inline-flex min-h-11 items-center text-emerald-800 underline"
            href={session ? "/cabinet" : "/login"}
          >
            {session ? "Личный кабинет" : "Войти"}
          </Link>
        </nav>
      </header>
      <main className="py-10 sm:py-14">{children}</main>
      <footer className="border-t border-stone-200 py-7 text-xs leading-6 text-stone-500">
        Учебная платформа. Не заменяет официальные учебники и клинические
        рекомендации.
      </footer>
    </div>
  );
}
