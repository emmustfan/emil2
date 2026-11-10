import { getDb } from "../db";
export async function courseMapTopics(userId?: string) {
  const rows = await getDb().topic.findMany({
    where: {
      status: "PUBLISHED",
      needsExpertReview: false,
      reviewedAt: { not: null },
      subject: { status: "PUBLISHED" },
    },
    select: {
      id: true,
      title: true,
      slug: true,
      isFree: true,
      subject: { select: { title: true, slug: true } },
      ...(userId
        ? {
            topicProgress_topicId: {
              where: { userId },
              select: { completedAt: true, gapsAnswered: true },
            },
          }
        : {}),
    },
    orderBy: [{ subject: { order: "asc" } }, { order: "asc" }, { id: "asc" }],
    take: 32,
  });
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    subject: t.subject.title,
    href: `/learn/${t.subject.slug}/${t.slug}`,
    free: t.isFree,
    completed: !!t.topicProgress_topicId?.[0]?.completedAt,
    started: !!t.topicProgress_topicId?.[0]?.gapsAnswered,
  }));
}
