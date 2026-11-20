import { z } from "zod";

export const groupId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const groupFields = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\p{Cc}]+$/u),
    course: z
      .union([z.number(), z.string().trim().regex(/^\d+$/)])
      .transform(Number)
      .pipe(z.number().int().min(1).max(6)),
    academicYear: z
      .string()
      .trim()
      .regex(/^\d{4}\/\d{4}$/)
      .refine((year) => {
        const [first, last] = year.split("/").map(Number);
        return last === first + 1;
      }),
  })
  .strict();

export const JOIN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const joinCodePattern = new RegExp(`^[${JOIN_ALPHABET}]{8}$`);
export function normalizeJoinCode(value: string) {
  const code = value.trim().toUpperCase();
  return joinCodePattern.test(code) ? code : null;
}

export function academicYear(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const first = month >= 9 ? year : year - 1;
  return `${first}/${first + 1}`;
}
