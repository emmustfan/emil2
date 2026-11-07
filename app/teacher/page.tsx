import type { Metadata } from "next";
import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { listSubjects } from "@/lib/content/service";
import { searchState } from "@/lib/content/page";
import { WorkspaceNav } from "@/components/workspace/nav";
import { Pagination } from "@/components/admin/pagination";
import { rolesRu as t, contentRu } from "@/lib/i18n/ru";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: t.teacherTitle,
  robots: { index: false, follow: false },
};
export default async function Teacher({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireEditor(),
    { q, page } = searchState(await searchParams),
    data = await listSubjects(q, page, user.id);
  return (
    <>
      <WorkspaceNav />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="text-3xl font-semibold">{t.teacherTitle}</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600">
          {t.teacherDescription}
        </p>
        <form className="mt-7 flex flex-wrap gap-3" role="search">
          <input
            aria-label={contentRu.searchPlaceholder}
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder={contentRu.searchPlaceholder}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-stone-300 px-3"
          />
          <button className="lesson-primary">{t.search}</button>
        </form>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {data.items.map((s) => (
            <article
              key={s.id}
              className="min-w-0 rounded-2xl border border-stone-200 bg-white p-6"
            >
              <h2 className="text-xl font-semibold break-words">{s.title}</h2>
              <p className="mt-3 text-xs leading-6 text-stone-500">
                {contentRu.statuses[s.status]} · Тем: {s._count.topic_subjectId}{" "}
                · Разделов: {s._count.section_subjectId}
              </p>
              <Link
                href={`/admin/subjects/${s.id}`}
                className="lesson-primary mt-5"
              >
                {t.editMaterials}
              </Link>
            </article>
          ))}
        </div>
        {!data.items.length && (
          <p className="mt-6 rounded-xl bg-emerald-50 p-5 text-sm leading-8">
            {q ? contentRu.empty : t.teacherEmpty}
          </p>
        )}
        <Pagination base="/teacher" q={q} {...data} />
      </main>
    </>
  );
}
