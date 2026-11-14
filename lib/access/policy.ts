export type Entitlements = {
  subscriptions: {
    status: string;
    subjectId: string | null;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    plan: { kind: string };
  }[];
  grants: { subjectId: string | null; expiresAt: Date }[];
};
export function allowsAccess(
  topic: { subjectId: string; isFree: boolean },
  rights: Entitlements,
  now: Date,
  graceDays: number,
) {
  if (topic.isFree) return true;
  return (
    rights.grants.some(
      (g) =>
        (g.subjectId === null || g.subjectId === topic.subjectId) &&
        g.expiresAt > now,
    ) ||
    rights.subscriptions.some((s) => {
      const scope =
        s.plan.kind === "ALL_SUBJECTS" ||
        (s.plan.kind === "SUBJECT" && s.subjectId === topic.subjectId);
      const end =
        s.currentPeriodEnd.getTime() +
        (s.status === "PAST_DUE" ? graceDays * 86400000 : 0);
      return (
        scope &&
        ["ACTIVE", "PAST_DUE"].includes(s.status) &&
        s.currentPeriodStart <= now &&
        end > now.getTime()
      );
    })
  );
}
