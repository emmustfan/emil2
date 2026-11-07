import { z } from "zod";
const access = z.object({
  role: z.enum(["USER", "EDITOR", "ADMIN"]),
  blocked: z.boolean(),
  subjectIds: z.array(z.string()),
});
export const auditAccess = z.object({ before: access, after: access });
