export type AppRole = "USER" | "EDITOR" | "ADMIN";
export function isStaff(role: AppRole) {
  return role === "EDITOR" || role === "ADMIN";
}
export function workspaceHref(role: AppRole) {
  return role === "ADMIN"
    ? "/admin"
    : role === "EDITOR"
      ? "/teacher"
      : "/cabinet";
}
export function canEditSubject(role: AppRole, assigned: boolean) {
  return role === "ADMIN" || (role === "EDITOR" && assigned);
}
export function protectedOwner(email: string | null, configured: string) {
  return (
    !!email &&
    configured
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .includes(email.toLowerCase())
  );
}
export function accessChangeError(input: {
  actorId: string;
  targetId: string;
  currentRole: AppRole;
  nextRole: AppRole;
  blocked: boolean;
  owner: boolean;
  otherAdmins: number;
  verified: boolean;
}) {
  if (
    (input.nextRole === "ADMIN" || input.nextRole === "EDITOR") &&
    input.nextRole !== input.currentRole &&
    !input.verified
  )
    return "Подтвердите почту или Telegram этого пользователя перед назначением роли.";
  if (input.owner && (input.nextRole !== "ADMIN" || input.blocked))
    return "Администратор из списка владельцев защищён от блокировки и понижения роли.";
  if (
    input.actorId === input.targetId &&
    (input.nextRole !== "ADMIN" || input.blocked)
  )
    return "Нельзя заблокировать себя или понизить собственную роль.";
  if (
    input.currentRole === "ADMIN" &&
    (input.nextRole !== "ADMIN" || input.blocked) &&
    input.otherAdmins < 1
  )
    return "Нельзя отключить последнего действующего администратора.";
  return null;
}
