import type { Prisma } from "../generated/prisma/client";
import { groupScopes, teachingScope } from "./group-policy";
import type { StaffActor } from "./policy";

export function progressSubjectScope(
  actor: StaffActor,
): Prisma.GroupSubjectWhereInput {
  const { admin, departments, faculties } = groupScopes(actor);
  if (actor.readOnly || (actor.role !== "ADMIN" && actor.role !== "EDITOR"))
    return { groupId: { in: [] } };
  if (admin) return {};
  return {
    OR: [
      { group: { facultyId: { in: faculties } } },
      { subject: { departmentId: { in: departments } } },
      teachingScope(actor),
    ],
  };
}
