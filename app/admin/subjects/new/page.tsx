import { getDb } from "@/lib/db";
import { departmentScope } from "@/lib/org";
import { forbidden, notFound } from "next/navigation";
import { requireEditor } from "@/lib/auth/server";
import { SubjectForm } from "@/components/admin/subject-form";
import { contentRu as t } from "@/lib/i18n/ru";
export default async function NewSubject({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string }>;
}) {
  const actor = await requireEditor(),
    { departmentId } = await searchParams;
  const departments = await getDb().department.findMany({
    where: {
      AND: [
        await departmentScope(actor, "subject.create"),
        { archivedAt: null, faculty: { archivedAt: null } },
      ],
    },
    select: { id: true, title: true, faculty: { select: { title: true } } },
    orderBy: [{ order: "asc" }, { title: "asc" }],
  });
  if (departmentId && !departments.some((d) => d.id === departmentId))
    notFound();
  if (!departments.length) forbidden();
  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="mb-7 text-3xl font-semibold">{t.newSubject}</h1>
      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <SubjectForm
          departments={departments.map((d) => ({
            id: d.id,
            title: d.faculty.title + " · " + d.title,
          }))}
          departmentId={departmentId}
        />
      </div>
    </main>
  );
}
