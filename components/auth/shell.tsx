import Link from "next/link";
import { BookOpen, ArrowLeft } from "lucide-react";
import { authRu, ru } from "@/lib/i18n/ru";
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:py-16">
      <Link
        href="/"
        className="mb-10 inline-flex min-h-11 items-center gap-3 text-sm font-semibold text-emerald-900"
      >
        <BookOpen aria-hidden size={24} />
        {ru.brand}
      </Link>
      <section className="rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm sm:p-10">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-4 leading-7 text-stone-600">{description}</p>
        )}
        <div className="mt-8">{children}</div>
      </section>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm text-emerald-800"
      >
        <ArrowLeft size={16} aria-hidden />
        {authRu.back}
      </Link>
    </main>
  );
}
export const inputClass =
  "mt-2 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base outline-offset-4 focus:outline-emerald-700";
