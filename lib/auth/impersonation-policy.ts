import { z } from "zod";
import type { AppRole } from "./roles";

export const IMPERSONATION_COOKIE = "impersonation";
export const IMPERSONATION_WRITE_MESSAGE =
  "Режим просмотра: изменения от имени пользователя запрещены";
export const impersonationInput = z
  .object({
    targetUserId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    reason: z
      .string()
      .trim()
      .min(5, "Укажите причину: от 5 до 500 символов.")
      .max(500, "Причина должна быть не длиннее 500 символов."),
  })
  .strict();
export type ImpersonationUser = {
  id: string;
  role: AppRole;
  blockedAt: Date | null;
  deletedAt: Date | null;
  anonymizedAt: Date | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  telegramId: bigint | null;
};
export function canImpersonate(
  admin: ImpersonationUser,
  target: ImpersonationUser,
) {
  return (
    admin.role === "ADMIN" &&
    !admin.blockedAt &&
    !admin.deletedAt &&
    !admin.anonymizedAt &&
    !!((admin.email && admin.emailVerifiedAt) || admin.telegramId) &&
    admin.id !== target.id &&
    (target.role === "USER" || target.role === "EDITOR") &&
    !target.deletedAt &&
    !target.anonymizedAt
  );
}
export function shouldAuditBlockedWrite(lastAt: Date | null, now: Date) {
  return !lastAt || now.getTime() - lastAt.getTime() >= 60000;
}
export function isImpersonationWrite(method: string, path: string) {
  return (
    path.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    !(method === "POST" && path === "/api/admin/impersonation/stop")
  );
}
