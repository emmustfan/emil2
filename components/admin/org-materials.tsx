import Link from "next/link";
import { getDb } from "@/lib/db";
import {
  can,
  departmentScope,
  managedFacultyIds,
  orgActor,
  type ContentReader,
} from "@/lib/org";
import { ContentTree } from "./content-tree";

export async function OrgMaterials({
  actor,
  subjects,
}: {
  actor: ContentReader;
  subjects: { id: string; departmentId: string; title: string }[];
}) {
  const user = await orgActor(actor);
  const departments = await getDb().department.findMany({
    where: {
      OR: [
        { id: { in: subjects.map((s) => s.departmentId) } },
        await departmentScope(actor, "department.staff"),
      ],
    },
    orderBy: [
      { faculty: { order: "asc" } },
      { faculty: { title: "asc" } },
      { order: "asc" },
      { title: "asc" },
    ],
  });
  const managed = await managedFacultyIds(actor);
  const faculties = await getDb().faculty.findMany({
    where: {
      OR: [
        { id: { in: departments.map((d) => d.facultyId) } },
        { id: { in: managed }, archivedAt: null },
      ],
    },
    orderBy: [{ order: "asc" }, { title: "asc" }],
  });
  return (
    <div className="space-y-4">
      {faculties.map((f) => (
        <details className="rounded-xl border bg-white p-4" key={f.id} open>
          <summary className="cursor-pointer text-lg font-semibold">
            {f.title}
          </summary>
          {managed.includes(f.id) && (
            <Link
              className="mt-2 block underline"
              href={"/teacher/org/faculties/" + f.id}
            >
              Управление факультетом
            </Link>
          )}
          <div className="mt-4 space-y-4">
            {departments
              .filter((d) => d.facultyId === f.id)
              .map(async (d) => {
                const [manage, create] = await Promise.all([
                  can(actor, "department.staff", { departmentId: d.id }),
                  can(actor, "subject.create", { departmentId: d.id }),
                ]);
                const items = subjects.filter((s) => s.departmentId === d.id);
                return (
                  <details className="rounded-lg border p-3" open key={d.id}>
                    <summary className="cursor-pointer font-semibold">
                      {d.title}
                      {d.archivedAt ? " · архив" : ""}
                    </summary>
                    <div className="my-2 flex flex-wrap gap-4">
                      {manage && (
                        <Link
                          className="underline"
                          href={"/teacher/org/departments/" + d.id}
                        >
                          Сотрудники кафедры
                        </Link>
                      )}
                      {create && !d.archivedAt && !f.archivedAt && (
                        <Link
                          className="underline"
                          href={"/admin/subjects/new?departmentId=" + d.id}
                        >
                          Создать предмет
                        </Link>
                      )}
                    </div>
                    {!!items.length && (
                      <ContentTree
                        subjects={items}
                        canManageSubjects={create}
                        teacherLinks={user.role === "EDITOR"}
                      />
                    )}
                  </details>
                );
              })}
          </div>
        </details>
      ))}
    </div>
  );
}
