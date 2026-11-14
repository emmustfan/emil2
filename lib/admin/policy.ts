import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  decodeSetting,
  type SettingKey,
} from "../settings/defaults";
export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const revision = z.iso.datetime().nullable();
export const planInput = z
  .object({
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(150),
    priceKopecks: z.number().int().min(0).max(100000000),
    tutorDailyLimit: z.number().int().min(0).max(100000),
    features: z.array(z.string().trim().min(1).max(300)).max(20),
    isActive: z.boolean(),
    order: z.number().int().min(0).max(10000),
  })
  .strict();
export const editableSettingKeys = (
  Object.keys(DEFAULT_SETTINGS) as SettingKey[]
).filter((k) => !k.startsWith("exam.") && !k.startsWith("demo.discount"));
export function validSetting(key: SettingKey, value: unknown) {
  return (
    editableSettingKeys.includes(key) &&
    JSON.stringify(decodeSetting(key, value)) === JSON.stringify(value) &&
    (key !== "billing.retryHours" ||
      (Array.isArray(value) && value.length === 2 && value[0] < value[1]))
  );
}
export const settingInput = z
  .object({
    revision,
    key: z
      .string()
      .refine(
        (k) => editableSettingKeys.includes(k as SettingKey),
        "Неизвестная настройка.",
      ),
    value: z.union([z.number(), z.array(z.number())]),
  })
  .strict()
  .refine(
    (v) => validSetting(v.key as SettingKey, v.value),
    "Значение настройки выходит за допустимые границы.",
  );
export const grantInput = z
  .object({
    requestId: z.uuid(),
    subjectId: identifier.nullable(),
    days: z.number().int().min(1).max(3650),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const legalInput = z
  .object({
    kind: z.enum(["oferta", "privacy", "consent", "refund"]),
    version: z
      .string()
      .trim()
      .regex(/^[\p{L}\d._-]{1,80}$/u),
    contentMd: z.string().trim().min(10).max(100000),
    previousId: identifier.nullable(),
    confirm: z.literal(true),
  })
  .strict();
export const reportInput = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    source: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export function reportRange(
  input: z.infer<typeof reportInput>,
  now = new Date(),
) {
  const end = input.to
    ? new Date(input.to + "T00:00:00Z")
    : new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const start = input.from
    ? new Date(input.from + "T00:00:00Z")
    : new Date(end.getTime() - 29 * 86400000);
  if (
    !Number.isFinite(+start) ||
    !Number.isFinite(+end) ||
    (input.from && start.toISOString().slice(0, 10) !== input.from) ||
    (input.to && end.toISOString().slice(0, 10) !== input.to) ||
    +end < +start ||
    +end - +start > 365 * 86400000
  )
    throw new Error("Выберите корректный период не длиннее года.");
  return {
    start,
    end: new Date(+end + 86400000),
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}
export function conversion(next: number, previous: number) {
  return previous > 0 ? Math.round((next / previous) * 1000) / 10 : null;
}
export function deletionError(owner: boolean, lastAdmin: boolean) {
  if (owner)
    return "Сначала передайте владение проектом: аккаунт из списка владельцев защищён от удаления.";
  if (lastAdmin)
    return "Сначала назначьте другого действующего администратора.";
  return null;
}
