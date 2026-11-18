import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/server";
import { contentPage } from "@/lib/content/page";
import { studentProgress } from "@/lib/progress/student";
import { StudentProgressCard } from "@/components/progress/student-card";
import { ImpersonateUser } from "@/components/admin/impersonate-user";
export const dynamic = "force-dynamic";
export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ subjectId?: string }>;
}) {
  const viewer = (await getCurrentSession())?.user,
    { id } = await params,
    { subjectId } = await searchParams;
  const data = await contentPage(() =>
    studentProgress(id, {
      viewerId: viewer?.id,
      subjectId: subjectId || undefined,
    }),
  );
  return (
    <main className="mx-auto max-w-5xl">
      <Link className="text-emerald-800 underline" href="/admin/progress">
        ← Прогресс студентов
      </Link>
      <h1 className="mt-5 text-3xl font-semibold">{data.user.name}</h1>
      {data.user.email && (
        <p className="mt-2 text-stone-500">{data.user.email}</p>
      )}
      {!data.user.deleted && (
        <Link
          href={`/admin/users/${id}`}
          className="mt-3 inline-block text-sm text-emerald-800 underline"
        >
          Карточка пользователя
        </Link>
      )}
      <form className="my-6 flex flex-wrap gap-3">
        <select
          name="subjectId"
          aria-label="Предмет прогресса"
          defaultValue={data.subjectId ?? ""}
          className="min-h-11 min-w-0 rounded border bg-white px-3"
        >
          <option value="">Все предметы</option>
          {data.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button className="lesson-primary">Показать</button>
      </form>
      {!data.user.deleted && viewer?.id !== id && (
        <ImpersonateUser userId={id} />
      )}
      <StudentProgressCard
        data={data}
        timeZone={viewer?.timezone ?? "Europe/Moscow"}
      />
    </main>
  );
}
