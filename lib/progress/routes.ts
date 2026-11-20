export function isStudentProgressPath(path: string) {
  return (
    path === "/admin/progress" ||
    path.startsWith("/admin/progress/") ||
    /^\/admin\/users\/[^/]+\/progress(?:\/|$)/.test(path)
  );
}

export function isGroupProgressPath(path: string) {
  return /^\/teacher\/groups\/[^/]+\/subjects(?:\/|$)/.test(path);
}

export const journalPath = (groupId: string, subjectId: string) =>
  `/teacher/groups/${groupId}/subjects/${subjectId}`;
