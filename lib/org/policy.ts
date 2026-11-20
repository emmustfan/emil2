import type { StaffRole } from "../generated/prisma/client";

export type GroupAction = "group.manage" | "group.members";

export type Action =
  | "content.read"
  | "content.edit"
  | "content.publish"
  | "content.unpublish"
  | "subject.create"
  | "subject.manage"
  | "department.staff"
  | "faculty.manage"
  | GroupAction
  | "progress.view";

export type Assignment = {
  role: StaffRole;
  facultyId: string | null;
  departmentId: string | null;
  subjectId: string | null;
};

export type StaffActor = {
  id: string;
  role: string;
  assignments: Assignment[];
  readOnly?: boolean;
};

export type Area = {
  facultyId: string;
  departmentId?: string;
  subjectId?: string;
  archived: boolean;
  requireSeparateReviewer?: boolean;
  draftUpdatedById?: string | null;
};

const permissions: Record<StaffRole, readonly Action[]> = {
  FACULTY_ADMIN: [
    "content.read",
    "content.unpublish",
    "department.staff",
    "faculty.manage",
  ],
  DEPARTMENT_HEAD: [
    "content.read",
    "content.edit",
    "content.publish",
    "content.unpublish",
    "subject.create",
    "subject.manage",
    "department.staff",
  ],
  AUTHOR: ["content.read", "content.edit", "content.publish"],
  REVIEWER: ["content.read", "content.publish"],
};

export function assignmentIncludes(assignment: Assignment, area: Area) {
  return !!(
    (assignment.subjectId && assignment.subjectId === area.subjectId) ||
    (assignment.departmentId &&
      assignment.departmentId === area.departmentId) ||
    (assignment.facultyId && assignment.facultyId === area.facultyId)
  );
}

export function roleAllows(role: StaffRole, action: Action) {
  return permissions[role].includes(action);
}

export function decide(
  actor: StaffActor,
  action: Action,
  area: Area,
): 200 | 403 | 404 {
  if (actor.role === "ADMIN")
    return actor.readOnly && action !== "content.read" ? 403 : 200;
  if (actor.role !== "EDITOR") return 403;
  const matching = actor.assignments.filter((a) => assignmentIncludes(a, area));
  if (!matching.length || area.archived) return 404;
  if (actor.readOnly && action !== "content.read") return 403;
  return matching.some(
    (a) =>
      roleAllows(a.role, action) &&
      !(
        action === "content.publish" &&
        area.requireSeparateReviewer &&
        (a.role === "AUTHOR" || area.draftUpdatedById === actor.id)
      ),
  )
    ? 200
    : 403;
}
