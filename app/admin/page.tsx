import { getDb } from "@/lib/db";
import { ContentTree } from "@/components/admin/content-tree";
import { MaterialQueue } from "@/components/admin/material-queue";
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
  const [users, review, paid] = await Promise.all([
    getDb().user.count({ where: { deletedAt: null } }),
    getDb().topic.count({ where: { status: "REVIEW" } }),
    getDb().payment.count({ where: { status: "SUCCEEDED" } }),
  ]);
  return (
    <main>
      <h1 className="text-3xl font-semibold">{rolesRu.adminTitle}</h1>
      <div className="student-stats">
        <div>
          <small>Пользователей</small>
          <strong>{users}</strong>
        </div>
        <div>
          <small>Уроков на проверке</small>
          <strong>{review}</strong>
        </div>
        <div>
          <small>Успешных оплат</small>
          <strong>{paid}</strong>
        </div>
      </div>
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
        <ContentTree subjects={data.items} canManageSubjects />
        <Pagination base="/admin" q={q} {...data} />
      </section>
      <MaterialQueue actor={user} />
    </main>
  );
}
