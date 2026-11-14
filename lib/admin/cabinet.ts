import { getDb } from "../db";
import { allowsAccess } from "../access/policy";
import { getSetting } from "../settings";
import { getTutorQuota } from "../tutor/quota";
export async function studentOverview(userId: string, now = new Date()) {
  const [progress, subs, grants, grace, quota] = await Promise.all([
    getDb().topicProgress.findMany({
      where: {
        userId,
        topic: {
          status: "PUBLISHED",
          needsExpertReview: false,
          subject: { status: "PUBLISHED" },
        },
      },
      select: {
        completedAt: true,
        testBestScore: true,
        lastOpenedAt: true,
        topic: {
          select: {
            subjectId: true,
            title: true,
            slug: true,
            subject: { select: { slug: true } },
          },
        },
      },
      orderBy: { lastOpenedAt: "desc" },
    }),
    getDb().subscription.findMany({
      where: { userId, status: { in: ["ACTIVE", "PAST_DUE"] } },
      include: { plan: { select: { kind: true } } },
    }),
    getDb().accessGrant.findMany({ where: { userId, expiresAt: { gt: now } } }),
    getSetting("billing.graceDays"),
    getTutorQuota({ userId }),
  ]);
  const ids = new Set([
    ...progress.map((p) => p.topic.subjectId),
    ...subs.flatMap((s) => (s.subjectId ? [s.subjectId] : [])),
    ...grants.flatMap((g) => (g.subjectId ? [g.subjectId] : [])),
  ]);
  const allAccess =
    subs.some(
      (s) =>
        s.plan.kind === "ALL_SUBJECTS" &&
        allowsAccess(
          { subjectId: "all", isFree: false },
          { subscriptions: [s], grants: [] },
          now,
          grace,
        ),
    ) || grants.some((g) => !g.subjectId);
  const subjects = await getDb().subject.findMany({
    where: {
      status: "PUBLISHED",
      ...(allAccess ? {} : { id: { in: [...ids] } }),
    },
    select: {
      id: true,
      title: true,
      slug: true,
      _count: {
        select: {
          topic_subjectId: {
            where: { status: "PUBLISHED", needsExpertReview: false },
          },
        },
      },
    },
    orderBy: { order: "asc" },
  });
  return {
    quota,
    recent: progress[0] ?? null,
    subjects: subjects.map((s) => {
      const records = progress.filter((p) => p.topic.subjectId === s.id),
        scores = records.flatMap((p) =>
          p.testBestScore !== null ? [p.testBestScore] : [],
        );
      const permitted = allowsAccess(
        { subjectId: s.id, isFree: false },
        { subscriptions: subs, grants },
        now,
        grace,
      );
      const ends = [
        ...subs
          .filter((sub) =>
            allowsAccess(
              { subjectId: s.id, isFree: false },
              { subscriptions: [sub], grants: [] },
              now,
              grace,
            ),
          )
          .map(
            (sub) =>
              new Date(
                +sub.currentPeriodEnd +
                  (sub.status === "PAST_DUE" ? grace * 86400000 : 0),
              ),
          ),
        ...grants
          .filter((g) => !g.subjectId || g.subjectId === s.id)
          .map((g) => g.expiresAt),
      ];
      return {
        id: s.id,
        title: s.title,
        slug: s.slug,
        total: s._count.topic_subjectId,
        completed: records.filter((p) => p.completedAt).length,
        average: scores.length
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : null,
        permitted,
        until: ends.length ? new Date(Math.max(...ends.map(Number))) : null,
      };
    }),
  };
}
