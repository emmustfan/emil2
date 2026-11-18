import Link from "next/link";
import {
  OrgEntityForm,
  StaffAssignmentForm,
  RevokeAssignment,
} from "./org-forms";
import { getDb } from "@/lib/db";
import { assignmentInclude, searchVerifiedUsers } from "@/lib/org/service";
export async function FacultyManager({
  facultyId,
  q = "",
  admin,
}: {
  facultyId?: string;
  q?: string;
  admin: boolean;
}) {
  const db = getDb();
  const [faculties, people] = await Promise.all([
    db.faculty.findMany({
      where: facultyId ? { id: facultyId } : {},
      orderBy: [{ order: "asc" }, { title: "asc" }],
      include: {
        staffAssignments: { include: assignmentInclude },
        departments: { orderBy: [{ order: "asc" }, { title: "asc" }] },
      },
    }),
    admin ? searchVerifiedUsers(q) : [],
  ]);
  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold">Факультеты и кафедры</h1>
      {admin && (
        <>
          <section className="emal-panel space-y-3">
            <h2>Новый факультет</h2>
            <OrgEntityForm entity="faculties" />
          </section>
          <form className="flex flex-wrap items-end gap-3" role="search">
            <label className="grid gap-1">
              Поиск администратора факультета{" "}
              <input
                className="min-h-11 rounded border bg-white px-3"
                name="q"
                defaultValue={q}
                placeholder="Имя или email"
              />
            </label>
            <button className="lesson-primary">Найти</button>
          </form>
        </>
      )}
      {faculties.map((f) => (
        <section key={f.id} className="emal-panel space-y-5">
          <h2>
            {f.title}
            {f.archivedAt ? " · архив" : ""}
          </h2>
          {admin && (
            <OrgEntityForm
              entity="faculties"
              initial={{ ...f, archived: !!f.archivedAt }}
            />
          )}
          {admin &&
            f.staffAssignments.map((a) => (
              <div key={a.id} className="border-b pb-3">
                <p>{a.user.name || a.user.email} · Администратор факультета</p>
                <RevokeAssignment
                  userId={a.userId}
                  role={a.role}
                  scope="faculty"
                  scopeId={f.id}
                />
              </div>
            ))}
          {admin &&
            !f.archivedAt &&
            people.map((u) => (
              <div key={u.id} className="border-b pb-3">
                <p>
                  {u.name || u.email}
                  {u.name && u.email ? " · " + u.email : ""}
                </p>
                <StaffAssignmentForm
                  userId={u.id}
                  roles={["FACULTY_ADMIN"]}
                  scope="faculty"
                  scopeId={f.id}
                />
              </div>
            ))}
          {!f.archivedAt && (
            <details className="space-y-4">
              <summary className="cursor-pointer font-semibold">
                Новая кафедра
              </summary>
              <OrgEntityForm entity="departments" facultyId={f.id} />
            </details>
          )}
          {f.departments.map((d) => (
            <section key={d.id} className="rounded border p-4 space-y-3">
              <h3 className="font-semibold">
                {d.title}
                {d.archivedAt ? " · архив" : ""}
              </h3>
              <Link
                prefetch={false}
                className="underline"
                href={"/teacher/org/departments/" + d.id}
              >
                Сотрудники кафедры
              </Link>
              {!f.archivedAt && (
                <OrgEntityForm
                  entity="departments"
                  facultyId={f.id}
                  initial={{ ...d, archived: !!d.archivedAt }}
                />
              )}
            </section>
          ))}
        </section>
      ))}
    </main>
  );
}
