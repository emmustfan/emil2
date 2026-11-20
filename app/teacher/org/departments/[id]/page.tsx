import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { WorkspaceShell } from "@/components/workspace/shell";
import { contentPage } from "@/lib/content/page";
import { can } from "@/lib/org";
import { departmentStaff } from "@/lib/org/service";
import { staffLabels } from "@/lib/org/labels";
import {
  ReviewerRule,
  RevokeAssignment,
  StaffAssignmentForm,
} from "@/components/admin/org-forms";

export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requireEditor(),
    { id } = await params,
    q = (await searchParams).q ?? "";
  const { department, people, assignments } = await contentPage(() =>
    departmentStaff(actor, id, q),
  );
  const [canManage, canCreate] = await Promise.all([
    can(actor, "faculty.manage", { facultyId: department.facultyId }),
    can(actor, "subject.create", { departmentId: id }),
  ]);
  return (
    <WorkspaceShell area="teacher">
      <main className="mx-auto max-w-4xl space-y-6">
        <Link className="underline" href="/teacher">
          ← Материалы
        </Link>
        <p className="text-sm">{department.faculty.title}</p>
        <h1 className="text-3xl font-semibold">{department.title}</h1>
        {canCreate && !department.archivedAt && (
          <Link
            className="lesson-primary"
            href={"/admin/subjects/new?departmentId=" + id}
          >
            Создать предмет
          </Link>
        )}
        <section className="emal-panel space-y-4">
          <h2>Настройки кафедры</h2>
          <ReviewerRule id={id} enabled={department.requireSeparateReviewer} />
        </section>
        <section className="emal-panel space-y-4">
          <h2>Сотрудники кафедры</h2>
          {!assignments.length && <p>Назначений пока нет.</p>}
          {assignments.map((a) => (
            <div key={a.id} className="rounded border p-3">
              <p>{a.user.name || a.user.email || "Пользователь"}</p>
              <p className="text-sm">
                {staffLabels[a.role]} · {a.subject?.title ?? department.title}
              </p>
              {(a.role !== "DEPARTMENT_HEAD" || canManage) && (
                <RevokeAssignment
                  userId={a.userId}
                  role={a.role}
                  scope={a.subjectId ? "subject" : "department"}
                  scopeId={a.subjectId ?? id}
                />
              )}
            </div>
          ))}
        </section>
        <section className="emal-panel space-y-4">
          <h2>Назначить сотрудника</h2>
          <form role="search" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1">
              Имя или email{" "}
              <input
                className="min-h-11 rounded border bg-white px-3"
                name="q"
                defaultValue={q}
                required
                maxLength={200}
              />
            </label>
            <button className="lesson-primary">Найти</button>
          </form>
          {q && !people.length && (
            <p>Подтверждённые пользователи не найдены.</p>
          )}
          {people.map((u) => (
            <div key={u.id} className="rounded border p-3">
              <p>
                {u.name || u.email}
                {u.name && u.email ? " · " + u.email : ""}
              </p>
              <StaffAssignmentForm
                userId={u.id}
                roles={
                  canManage
                    ? ["AUTHOR", "REVIEWER", "DEPARTMENT_HEAD"]
                    : ["AUTHOR", "REVIEWER"]
                }
                scope="department"
                scopeId={id}
                subjects={department.subjects}
              />
            </div>
          ))}
        </section>
      </main>
    </WorkspaceShell>
  );
}
