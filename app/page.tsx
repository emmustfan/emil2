import Link from "next/link";
import { ArrowDown, BookOpen, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ru, authRu } from "@/lib/i18n/ru";
export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-6 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-950/10 py-7">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-emerald-900 p-3 text-white">
            <BookOpen aria-hidden size={22} />
          </span>
          <span className="text-sm font-semibold">{ru.brand}</span>
        </div>
        <Link
          href="/subjects"
          className="inline-flex min-h-11 items-center text-sm text-emerald-800 underline"
        >
          Предметы
        </Link>
        <Button asChild variant="outline">
          <a href="/login">{authRu.login}</a>
        </Button>
        <span className="rounded-full border border-emerald-900/15 px-4 py-2 text-xs text-emerald-900">
          {ru.badge}
        </span>
      </header>
      <main>
        <section className="grid items-center gap-12 py-20 md:grid-cols-[1.5fr_1fr] md:py-28">
          <div>
            <p className="mb-6 text-xs font-semibold tracking-widest uppercase text-emerald-800">
              {ru.label}
            </p>
            <h1 className="max-w-2xl text-4xl leading-[1.12] font-semibold tracking-tight sm:text-6xl">
              {ru.title}
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-stone-600">
              {ru.description}
            </p>
            <Button asChild className="mt-9">
              <a href="#approach">
                {ru.navigation}
                <ArrowDown size={16} aria-hidden />
              </a>
            </Button>
          </div>
          <aside className="rounded-3xl border border-emerald-900/10 bg-white p-8 shadow-sm">
            <Layers3 className="mb-10 text-emerald-800" size={38} aria-hidden />
            <p className="text-sm font-semibold text-emerald-800">{ru.stage}</p>
            <p className="mt-4 leading-7 text-stone-600">{ru.stageNote}</p>
            <div
              className="mt-8 h-1.5 overflow-hidden rounded-full bg-stone-100"
              aria-hidden
            >
              <div className="h-full w-1/12 rounded-full bg-emerald-700" />
            </div>
          </aside>
        </section>
        <section
          id="approach"
          aria-label={ru.navigation}
          className="grid gap-6 border-t border-emerald-950/10 py-12 sm:grid-cols-3"
        >
          {ru.features.map((item) => (
            <article key={item.number} className="py-3">
              <p className="mb-7 font-mono text-sm text-emerald-700">
                {item.number} /
              </p>
              <h2 className="text-xl font-semibold">{item.title}</h2>
              <p className="mt-3 max-w-xs text-sm leading-7 text-stone-600">
                {item.text}
              </p>
            </article>
          ))}
        </section>
      </main>
      <footer className="border-t border-emerald-950/10 py-7">
        <p className="max-w-2xl text-xs leading-6 text-stone-500">
          {ru.disclaimer}
        </p>
      </footer>
    </div>
  );
}
