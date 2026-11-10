import { publicMetadata } from "@/lib/ops/seo";
import Link from "next/link";
import { LegalEntity } from "@/components/legal/entity";
import type { Metadata } from "next";
import {
  BookOpen,
  ArrowUpRight,
  Layers,
  MessageSquare,
  ListChecks,
} from "lucide-react";
import { landingContent, publicExamples } from "@/lib/landing/content";
import { LandingExample } from "@/components/landing/example";
import { LandingPlans } from "@/components/landing/plans";
import { getDb } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/server";
import { Brand } from "@/components/workspace/brand";
import { CourseMap } from "@/components/workspace/course-map";
import { courseMapTopics } from "@/lib/ui/course-map";
import { HeroExample } from "@/components/landing/hero-example";
import { getEnv } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const c = await landingContent(),
    url = getEnv().APP_URL;
  return {
    ...publicMetadata(
      "/",
      `${c.brand} — обучение для стоматологов`,
      c.description,
    ),
    description: c.description,
    alternates: { canonical: url },
    openGraph: {
      title: c.title,
      description: c.description,
      url,
      type: "website",
      locale: "ru_RU",
      siteName: c.brand,
      images: [new URL("/opengraph-image", url).href],
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
  const mapTopics = await courseMapTopics();
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
    <div className="landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(data).replace(/</g, "\\u003c"),
        }}
      />
      <header className="landing-header">
        <div className="landing-container">
          <Brand name={c.brand} />
          <nav aria-label="Основная навигация">
            <Link href="/subjects">Предметы</Link>
            <a href="#approach">Как это работает</a>
            <a href="#plans">Тарифы</a>
            <a href="#faq">Вопросы</a>
          </nav>
          <div className="header-cta">
            <Link
              className="login-link text-sm"
              href={session ? "/cabinet" : "/login"}
            >
              {session ? "Личный кабинет" : "Войти"}
            </Link>
            <Link href="/demo?source=landing" className="lesson-primary">
              {c.demoCta}
            </Link>
          </div>
          <details className="landing-mobile">
            <summary className="py-2 text-sm">☰ Меню</summary>
            <nav aria-label="Мобильная навигация">{nav}</nav>
          </details>
        </div>
      </header>
      <main>
        <section className="landing-hero">
          <div className="landing-container">
            <div>
              <p className="emal-eyebrow mb-4">Для студентов-стоматологов</p>
              <h1>{c.title}</h1>
              <p className="landing-lead">{c.description}</p>
              <div className="hero-actions">
                <Link className="lesson-primary" href="/demo?source=landing">
                  {c.demoCta}
                  <ArrowUpRight size={17} aria-hidden />
                </Link>
                <Link
                  className="emal-button emal-button-outline"
                  href="/subjects"
                >
                  Посмотреть предметы
                </Link>
              </div>
              <p className="hero-caption">
                Начните без регистрации. В конце демо можно сохранить результат.
              </p>
            </div>
            <HeroExample example={publicExamples(c)[0]} />
          </div>
        </section>
        <section className="landing-band">
          <div className="landing-container landing-map">
            <div>
              <h2>
                Весь курс —<br />
                как на ладони
              </h2>
              <p className="sub">
                Каждый зуб в формуле — тема курса. Выберите её, чтобы открыть
                урок. Пройденные темы отмечаются в личном кабинете.
              </p>
              <ul className="mt-6 space-y-3 text-sm emal-muted">
                {c.benefits.map((b) => (
                  <li key={b} className="flex gap-3">
                    <span className="text-[var(--gum)]" aria-hidden>
                      ✓
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <CourseMap topics={mapTopics} />
          </div>
        </section>
        <section id="approach" className="landing-band is-white scroll-mt-5">
          <div className="landing-container">
            <h2>Как это работает</h2>
            <div className="landing-steps">
              {c.how.map((item, i) => (
                <article key={item.title}>
                  <div className="landing-step-number">0{i + 1}</div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section id="example" className="landing-band">
          <div className="landing-container">
            <h2>Попробуйте прямо здесь</h2>
            <p className="sub mb-7">
              Все варианты видны сразу. Выберите один или несколько ответов,
              затем откройте карточку повторения.
            </p>
            <LandingExample examples={publicExamples(c)} />
          </div>
        </section>
        <section className="landing-band is-white">
          <div className="landing-container">
            <h2>Всё для работы с темой</h2>
            <div className="landing-features">
              {c.inside.map((item, i) => {
                const Icon = [BookOpen, ListChecks, Layers, MessageSquare][
                  i % 4
                ];
                return (
                  <article className="landing-feature" key={item.title}>
                    <Icon size={28} aria-hidden />
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section id="subjects" className="landing-band">
          <div className="landing-container">
            <h2>Предметы</h2>
            {!subjects.length && (
              <p className="sub">
                Первые материалы готовятся к публикации после проверки
                экспертом.
              </p>
            )}
            <div className="mt-6 border-t border-stone-200">
              {subjects.map((subject) => (
                <article className="landing-subject" key={subject.id}>
                  <div>
                    <h3>{subject.title}</h3>
                    <p>{subject.shortDescription}</p>
                    <p className="text-xs">
                      Курсы:{" "}
                      {subject.courses
                        .map((n) => (n === 6 ? "выпускник" : n))
                        .join(", ")}{" "}
                      · Тем: {subject.topic_subjectId.length}
                    </p>
                  </div>
                  <Link
                    href={`/subjects/${subject.slug}`}
                    className="emal-button emal-button-outline"
                  >
                    {subject.topic_subjectId.some((t) => t.isFree)
                      ? "Есть бесплатная тема"
                      : "Посмотреть темы"}{" "}
                    →
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
        <div className="landing-band is-white">
          <div className="landing-container">
            <LandingPlans note={c.paymentNote} />
          </div>
        </div>
        <section id="faq" className="landing-band">
          <div className="landing-container">
            <h2 className="mb-7">Частые вопросы</h2>
            {c.faq.map((f) => (
              <details
                key={f.question}
                className="border-b border-stone-200 py-4"
              >
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                  {f.question}
                </summary>
                <p className="max-w-3xl pb-3 text-sm leading-7 emal-muted">
                  {f.answer}
                </p>
              </details>
            ))}
          </div>
        </section>
        <section className="landing-band">
          <div className="landing-container">
            <div className="landing-final">
              <h2>Начните с одного урока</h2>
              <p className="mt-4 max-w-xl text-sm leading-7">
                Выберите цель, проверьте себя и попробуйте повторение. Вход
                понадобится, когда решите сохранить прогресс.
              </p>
              <Link href="/demo?source=landing" className="lesson-primary mt-6">
                {c.demoCta}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-container">
          <Brand name={c.brand} />
          <div className="mt-6">
            <LegalEntity />
          </div>
          <p className="mt-5 max-w-3xl text-xs leading-6">{c.disclaimer}</p>
          <nav
            aria-label="Документы"
            className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs"
          >
            {[
              ["oferta", "Оферта"],
              ["privacy", "Конфиденциальность"],
              ["consent", "Согласие"],
              ["refund", "Возврат"],
            ].map(([slug, title]) => (
              <Link key={slug} href={`/legal/${slug}`}>
                {title}
              </Link>
            ))}
            {support && <a href={`mailto:${support}`}>Поддержка</a>}
          </nav>
        </div>
      </footer>
    </div>
  );
}
