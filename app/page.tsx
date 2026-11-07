import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { landingContent, publicExamples } from "@/lib/landing/content";
import { LandingExample } from "@/components/landing/example";
import { LandingPlans } from "@/components/landing/plans";
import { getDb } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/server";
import { getEnv } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const c = await landingContent(),
    url = getEnv().APP_URL;
  return {
    title: `${c.brand} — обучение для стоматологов`,
    description: c.description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title: c.title,
      description: c.description,
      url,
      type: "website",
      locale: "ru_RU",
      siteName: c.brand,
    },
  };
}
export default async function Home() {
  const [c, session, subjects] = await Promise.all([
    landingContent(),
    getCurrentSession(),
    getDb().subject.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ order: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        slug: true,
        courses: true,
        shortDescription: true,
        topic_subjectId: {
          where: { status: "PUBLISHED" },
          select: { id: true, isFree: true },
        },
      },
    }),
  ]);
  const url = getEnv().APP_URL,
    support = getEnv().SUPPORT_EMAIL;
  const nav = (
    <>
      <Link href="/subjects">Предметы</Link>
      <a href="#approach">Как это работает</a>
      <a href="#plans">Тарифы</a>
      <Link href={session ? "/cabinet" : "/login"}>
        {session ? "Личный кабинет" : "Войти"}
      </Link>
    </>
  );
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: c.brand, url },
      {
        "@type": "FAQPage",
        mainEntity: c.faq.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      },
      ...subjects.map((s) => ({
        "@type": "Course",
        name: s.title,
        description: s.shortDescription,
        url: `${url}/subjects/${s.slug}`,
        provider: { "@type": "Organization", name: c.brand, url },
      })),
    ],
  };
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(data).replace(/</g, "\\u003c"),
        }}
      />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-950/10 py-5">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 text-sm font-semibold"
        >
          <BookOpen className="text-emerald-800" aria-hidden />
          {c.brand}
        </Link>
        <nav
          aria-label="Основная навигация"
          className="hidden items-center gap-5 text-sm lg:flex"
        >
          {nav}
        </nav>
        <Link href="/demo?source=landing" className="lesson-primary">
          {c.demoCta}
        </Link>
        <details className="w-full lg:hidden">
          <summary className="min-h-11 cursor-pointer py-3 text-sm">
            ☰ Меню
          </summary>
          <nav
            aria-label="Мобильная навигация"
            className="flex flex-col gap-5 py-4 text-sm"
          >
            {nav}
          </nav>
        </details>
      </header>
      <main>
        <section className="grid items-center gap-10 py-16 md:grid-cols-[1.3fr_1fr] md:py-24">
          <div>
            <p className="mb-5 text-xs font-semibold tracking-widest text-emerald-800 uppercase">
              Для студентов-стоматологов
            </p>
            <h1 className="max-w-2xl text-4xl leading-[1.12] font-semibold tracking-tight sm:text-6xl">
              {c.title}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-stone-600">
              {c.description}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <Link href="/demo?source=landing" className="lesson-primary">
                {c.demoCta}
                <ArrowUpRight size={17} aria-hidden />
              </Link>
              <Link
                href="/subjects"
                className="inline-flex min-h-11 items-center underline"
              >
                Посмотреть предметы
              </Link>
            </div>
          </div>
          <aside className="rounded-3xl border border-emerald-900/15 bg-emerald-50/60 p-7 sm:p-9">
            <p className="mb-7 text-sm font-semibold text-emerald-900">
              От первого вопроса — к устойчивому знанию
            </p>
            <ul className="space-y-5">
              {c.benefits.map((b, i) => (
                <li
                  key={b}
                  className="flex items-start gap-4 text-sm leading-7"
                >
                  <span aria-hidden className="font-mono text-emerald-700">
                    0{i + 1}
                  </span>
                  {b}
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-emerald-900/10 pt-5 text-xs leading-6 text-stone-600">
              Начните без регистрации. В конце демо можно сохранить результат.
            </p>
          </aside>
        </section>
        <section id="example" className="border-t border-stone-200 py-12">
          <h2 className="mb-4 text-3xl font-semibold">
            Попробуйте прямо здесь
          </h2>
          <p className="mb-7 max-w-xl leading-7 text-stone-600">
            Все варианты видны сразу. Выберите один или несколько ответов, затем
            откройте карточку повторения.
          </p>
          <LandingExample examples={publicExamples(c)} />
        </section>
        <section
          id="approach"
          className="scroll-mt-8 border-t border-stone-200 py-12"
        >
          <h2 className="text-3xl font-semibold">Как это работает</h2>
          <div className="mt-7 grid gap-7 sm:grid-cols-3">
            {c.how.map((item, i) => (
              <article key={item.title}>
                <p className="mb-5 font-mono text-sm text-emerald-700">
                  0{i + 1} /
                </p>
                <h3 className="text-xl font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-stone-600">
                  {item.text}
                </p>
              </article>
            ))}
          </div>
        </section>
        <section className="border-t border-stone-200 py-12">
          <h2 className="text-3xl font-semibold">Всё для работы с темой</h2>
          <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {c.inside.map((item) => (
              <article
                key={item.title}
                className="rounded-2xl border border-stone-200 bg-white p-6"
              >
                <h3 className="text-xl font-semibold">{item.title}</h3>
                <p className="mt-4 text-sm leading-7 text-stone-600">
                  {item.text}
                </p>
              </article>
            ))}
          </div>
        </section>
        <section id="subjects" className="border-t border-stone-200 py-12">
          <h2 className="text-3xl font-semibold">Предметы</h2>
          {!subjects.length && (
            <p className="mt-5 text-stone-600">
              Первые материалы готовятся к публикации после проверки экспертом.
            </p>
          )}
          <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((s) => (
              <Link
                href={`/subjects/${s.slug}`}
                key={s.id}
                className="rounded-2xl border border-stone-200 bg-white p-6 hover:border-emerald-700"
              >
                <h3 className="text-xl font-semibold">{s.title}</h3>
                <p className="mt-3 text-sm leading-7 text-stone-600">
                  {s.shortDescription}
                </p>
                <p className="mt-5 text-xs text-stone-600">
                  Курсы:{" "}
                  {s.courses.map((n) => (n === 6 ? "выпускник" : n)).join(", ")}{" "}
                  · Тем: {s.topic_subjectId.length}
                </p>
                {s.topic_subjectId.some((t) => t.isFree) && (
                  <p className="mt-3 text-sm font-semibold text-emerald-800">
                    Есть бесплатная тема →
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
        <LandingPlans note={c.paymentNote} />
        <section className="border-t border-stone-200 py-12">
          <h2 className="mb-7 text-3xl font-semibold">Частые вопросы</h2>
          {c.faq.map((f) => (
            <details
              key={f.question}
              className="border-b border-stone-200 py-4"
            >
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                {f.question}
              </summary>
              <p className="max-w-3xl pb-3 text-sm leading-7 text-stone-600">
                {f.answer}
              </p>
            </details>
          ))}
        </section>
        <section className="my-10 rounded-3xl bg-emerald-900 px-6 py-10 text-white sm:p-12">
          <h2 className="max-w-xl text-3xl font-semibold">
            Начните с одного урока
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-emerald-50">
            Выберите цель, проверьте себя и попробуйте повторение. Вход
            понадобится, когда решите сохранить прогресс.
          </p>
          <Link
            href="/demo?source=landing"
            className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-white px-5 py-3 font-semibold text-emerald-900"
          >
            {c.demoCta}
          </Link>
        </section>
      </main>
      <footer className="border-t border-stone-200 py-8 text-xs leading-6 text-stone-600">
        <p className="max-w-3xl">{c.disclaimer}</p>
        <nav
          aria-label="Документы"
          className="mt-4 flex flex-wrap gap-x-5 gap-y-2"
        >
          {[
            ["oferta", "Оферта"],
            ["privacy", "Конфиденциальность"],
            ["consent", "Согласие"],
            ["refund", "Возврат"],
          ].map(([slug, title]) => (
            <Link
              className="inline-flex min-h-11 items-center underline"
              key={slug}
              href={`/legal/${slug}`}
            >
              {title}
            </Link>
          ))}
          {support && (
            <a
              className="inline-flex min-h-11 items-center underline"
              href={`mailto:${support}`}
            >
              Поддержка
            </a>
          )}
        </nav>
      </footer>
    </div>
  );
}
