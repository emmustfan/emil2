import type { StaffRole } from "../generated/prisma/client";
export const staffLabels: Record<StaffRole, string> = {
  FACULTY_ADMIN: "Администратор факультета",
  DEPARTMENT_HEAD: "Заведующий кафедрой",
  AUTHOR: "Автор",
  REVIEWER: "Рецензент",
};
