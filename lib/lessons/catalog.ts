import { getDb } from "../db";
import { hasAccess } from "../access";
export function lessonHref(subject: string, topic: string) {
  return `/learn/${encodeURIComponent(subject)}/${encodeURIComponent(topic)}`;
}
export { formatPrice } from "../format";
export async function plans() {
  return getDb().plan.findMany({
    where: { isActive: true, kind: { in: ["SUBJECT", "ALL_SUBJECTS"] } },
    orderBy: [{ order: "asc" }, { code: "asc" }],
    select: {
      code: true,
      title: true,
      priceKopecks: true,
      kind: true,
      periodMonths: true,
      features: true,
    },
  });
}
export async function catalog(userId: string | null, course?: number) {
  const subjects = await getDb().subject.findMany({
    where: {
      status: "PUBLISHED",
      ...(course ? { courses: { has: course } } : {}),
    },
    orderBy: [{ order: "asc" }, { title: "asc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      courses: true,
      shortDescription: true,
      topic_subjectId: {
        where: { status: "PUBLISHED" },
        orderBy: [{ order: "asc" }, { title: "asc" }],
        select: {
          id: true,
          slug: true,
          title: true,
          isFree: true,
          sectionId: true,
          _count: {
            select: {
              gap_topicId: { where: { archivedAt: null } },
              question_topicId: { where: { archivedAt: null } },
            },
          },
          ...(userId
            ? {
                topicProgress_topicId: {
                  where: { userId },
                  select: {
                    gapsAnswered: true,
                    completedAt: true,
                    lastOpenedAt: true,
                  },
                },
              }
            : {}),
        },
      },
    },
  });
  return Promise.all(
    subjects.map(async (s) => ({
      ...s,
      open: await hasAccess(userId, { subjectId: s.id, isFree: false }),
    })),
  );
}
