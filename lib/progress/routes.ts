export function isStudentProgressPath(path: string) {
  return (
    path === "/admin/progress" ||
    path.startsWith("/admin/progress/") ||
    /^\/admin\/users\/[^/]+\/progress(?:\/|$)/.test(path)
  );
}
