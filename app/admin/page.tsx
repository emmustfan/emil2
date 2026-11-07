import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { listSubjects } from "@/lib/content/service";
import { searchState } from "@/lib/content/page";
import { contentRu as t, rolesRu } from "@/lib/i18n/ru";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/admin/pagination";
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireEditor();
  if (user.role === "EDITOR") redirect("/teacher");
  const { q, page } = searchState(await searchParams);
  const data = await listSubjects(q, page, user.id);
  return (
    <main>
      <h1 className="text-3xl font-semibold">{rolesRu.adminTitle}</h1>
      <Link
        href="/admin/users"
        className="mt-5 inline-flex min-h-11 items-center text-emerald-800 underline"
      >
        {rolesRu.users}
      </Link>
      <p className="mt-3 text-sm text-stone-600">{t.description}</p>
      <section className="mt-8 rounded-2xl border border-stone-200 bg-white p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold">{t.subjects}</h2>
          <Button asChild>
            <Link href="/admin/subjects/new">{t.newSubject}</Link>
          </Button>
        </div>
        <form className="my-6 flex flex-wrap gap-3" role="search">
          <input
            name="q"
            aria-label={t.searchPlaceholder}
            placeholder={t.searchPlaceholder}
            defaultValue={q}
            className="min-h-11 min-w-48 flex-1 rounded-xl border border-stone-300 px-4"
            maxLength={200}
          />
          <Button variant="outline">{t.search}</Button>
        </form>
        <div className="overflow-auto">
          <table className="w-full min-w-xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="p-3">{t.name}</th>
                <th className="p-3">{t.status}</th>
                <th className="p-3">{t.sections}</th>
                <th className="p-3">{t.topics}</th>
                <th className="p-3">{t.order}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="border-b border-stone-100">
                  <td className="p-3">
                    <Link
                      href={`/admin/subjects/${s.id}`}
                      className="inline-flex min-h-11 items-center font-medium text-emerald-800 underline"
                    >
                      {s.title}
                    </Link>
                    <p className="text-xs text-stone-500">{s.slug}</p>
                  </td>
                  <td className="p-3">{t.statuses[s.status]}</td>
                  <td className="p-3">{s._count.section_subjectId}</td>
                  <td className="p-3">{s._count.topic_subjectId}</td>
                  <td className="p-3">{s.order}</td>
                </tr>
              ))}
              {!data.items.length && (
                <tr>
                  <td colSpan={5} className="py-8 text-stone-500">
                    {t.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination base="/admin" q={q} {...data} />
      </section>
    </main>
  );
}
