import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import {
  getSubject,
  listSections,
  listTopics,
  subjectDTO,
} from "@/lib/content/service";
import { contentPage, searchState } from "@/lib/content/page";
import { contentRu as t } from "@/lib/i18n/ru";
import { SubjectForm } from "@/components/admin/subject-form";
import { SectionForm } from "@/components/admin/section-form";
import { Pagination } from "@/components/admin/pagination";
import { Button } from "@/components/ui/button";
export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireEditor();
  const { id } = await params;
  const { q, page } = searchState(await searchParams);
  const subject = await contentPage(() => getSubject(id, user.id));
  const [sections, topics] = await Promise.all([
    listSections(id, user.id),
    listTopics(id, q, page, user.id),
  ]);
  return (
    <main className="space-y-8">
      <h1 className="text-3xl font-semibold">{subject.title}</h1>
      {user.role === "ADMIN" && (
        <details className="rounded-2xl border border-stone-200 bg-white p-6">
          <summary className="min-h-11 cursor-pointer text-lg font-semibold">
            {t.editSubject}
          </summary>
          <div className="mt-6">
            <SubjectForm
              key={`${subject.id}-${subject.editRevision}`}
              initial={subjectDTO(subject)}
            />
          </div>
        </details>
      )}
      <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-7">
        <h2 className="mb-5 text-2xl font-semibold">{t.sections}</h2>
        <div className="space-y-4">
          {sections.map((s) => (
            <SectionForm
              key={`${s.id}-${s.editRevision}`}
              subjectId={id}
              initial={s}
            />
          ))}
          <SectionForm subjectId={id} />
        </div>
      </section>
      <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-7">
        <Link
          href={`/admin/subjects/${id}/topics/new`}
          className="mb-5 inline-flex min-h-11 items-center text-emerald-800 underline"
        >
          Создать урок из PDF, Word или текста
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold">{t.topics}</h2>
          <Button asChild>
            <Link href={`/admin/subjects/${id}/topics/new`}>{t.newTopic}</Link>
          </Button>
        </div>
        <form role="search" className="my-5 flex flex-wrap gap-3">
          <input
            name="q"
            aria-label={t.searchPlaceholder}
            placeholder={t.searchPlaceholder}
            defaultValue={q}
            maxLength={200}
            className="min-h-11 min-w-48 flex-1 rounded-xl border border-stone-300 px-4"
          />
          <Button variant="outline">{t.search}</Button>
        </form>
        <div className="overflow-auto">
          <table className="w-full min-w-xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="p-3">{t.name}</th>
                <th className="p-3">{t.section}</th>
                <th className="p-3">{t.status}</th>
                <th className="p-3">{t.questions}</th>
                <th className="p-3">{t.order}</th>
              </tr>
            </thead>
            <tbody>
              {topics.items.map((row) => (
                <tr key={row.id} className="border-b border-stone-100">
                  <td className="p-3">
                    <Link
                      className="inline-flex min-h-11 items-center text-emerald-800 underline"
                      href={`/admin/topics/${row.id}`}
                    >
                      {row.title}
                    </Link>
                  </td>
                  <td className="p-3">{row.section?.title ?? "—"}</td>
                  <td className="p-3">{t.statuses[row.status]}</td>
                  <td className="p-3">{row._count.question_topicId}</td>
                  <td className="p-3">{row.order}</td>
                </tr>
              ))}
              {!topics.items.length && (
                <tr>
                  <td colSpan={5} className="py-7 text-stone-500">
                    {t.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination base={`/admin/subjects/${id}`} q={q} {...topics} />
      </section>
    </main>
  );
}
