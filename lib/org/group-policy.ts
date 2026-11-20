import type { StaffActor } from "./policy";

export function groupScopes(actor: StaffActor) {
  const staff = actor.role === "EDITOR" ? actor.assignments : [];
  return {
    admin: actor.role === "ADMIN",
    faculties: staff.flatMap((a) =>
      a.role === "FACULTY_ADMIN" && a.facultyId ? [a.facultyId] : [],
    ),
    departments: staff.flatMap((a) =>
      a.role === "DEPARTMENT_HEAD" && a.departmentId ? [a.departmentId] : [],
    ),
  };
}

export function groupPermissions(
  actor: StaffActor,
  group: {
    facultyId: string;
    archivedAt: Date | null;
    faculty: { archivedAt: Date | null };
  },
  teaches: boolean,
) {
  const scope = groupScopes(actor);
  const oversees = scope.admin || scope.faculties.includes(group.facultyId);
  const active = !group.archivedAt && !group.faculty.archivedAt;
  const roster = oversees || (active && teaches);
  return {
    read: oversees || (active && (teaches || scope.departments.length > 0)),
    roster,
    manage: active && oversees && !actor.readOnly,
    members: active && roster && !actor.readOnly,
  };
}
