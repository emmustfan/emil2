import { z } from "zod";
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  university: z.string().trim().max(200).default(""),
  course: z
    .union([z.literal(""), z.enum(["1", "2", "3", "4", "5", "6"])])
    .transform((v) => (v ? Number(v) : null)),
  timezone: z
    .string()
    .max(100)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("ru", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
});
export function adminRole(
  email: string | null,
  configured: string,
  current: "USER" | "EDITOR" | "ADMIN" = "USER",
) {
  return email &&
    configured
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .includes(email.toLowerCase())
    ? ("ADMIN" as const)
    : current;
}
