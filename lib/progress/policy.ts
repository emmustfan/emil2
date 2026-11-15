import { z } from "zod";
export const progressFilters = z
  .object({
    q: z.string().trim().max(200).default(""),
    filter: z.enum(["all", "lagging"]).default("all"),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    sort: z
      .enum([
        "name",
        "subjects",
        "completed",
        "average",
        "due",
        "overdue",
        "lastActivity",
      ])
      .default("name"),
    direction: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict();
export function isLagging(
  completed: number,
  total: number,
  lastActivity: Date | null,
  createdAt: Date,
  now: Date,
  settings: { minCompletionPercent: number; inactiveDays: number },
) {
  return (
    (total ? (completed / total) * 100 : 0) < settings.minCompletionPercent ||
    +now - +(lastActivity ?? createdAt) > settings.inactiveDays * 86400000
  );
}
export { isStudentProgressPath } from "./routes";
