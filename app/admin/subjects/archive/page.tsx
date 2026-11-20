import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { listSubjects } from "@/lib/content/service";
import { searchState } from "@/lib/content/page";
import { Pagination } from "@/components/admin/pagination";
import { Button } from "@/components/ui/button";

export default async function SubjectArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireEditor();
  const { q, page } = searchState(await searchParams);
  const data = await listSubjects(q, page, user, true);

  return (
    <main className="space-y-5">
      <Link
        className="underline"
        href={user.role === "ADMIN" ? "/admin" : "/teacher"}
      >
        К предметам
      </Link>
      <h1 className="text-3xl font-semibold">Архив предметов</h1>
      <form className="flex flex-wrap gap-3" role="search">
        <input
          name="q"
          aria-label="Название или адрес предмета"
          placeholder="Название или адрес предмета"
          defaultValue={q}
          className="min-h-11 min-w-48 flex-1 rounded-xl border border-stone-300 px-4"
          maxLength={200}
        />
        <Button variant="outline">Найти</Button>
      </form>
      {data.items.length ? (
        <ul className="divide-y rounded-2xl border border-stone-200 bg-white">
          {data.items.map((subject) => (
            <li key={subject.id}>
              <Link
                className="block px-5 py-4 underline"
                href={`/admin/subjects/${subject.id}`}
              >
                {subject.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="emal-empty">
          {q ? "Предметы не найдены." : "Архив пока пуст."}
        </p>
      )}
      <Pagination base="/admin/subjects/archive" q={q} {...data} />
    </main>
  );
}
