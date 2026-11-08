import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { canIndex } from "@/lib/ops/seo";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!canIndex()) return [];
  const db = getDb(),
    base = process.env.APP_URL!;
  const [subjects, topics] = await Promise.all([
    db.subject.findMany({
      where: { status: "PUBLISHED" },
      select: { slug: true },
    }),
    db.topic.findMany({
      where: {
        status: "PUBLISHED",
        isFree: true,
        needsExpertReview: false,
        reviewedAt: { not: null },
        subject: { status: "PUBLISHED" },
      },
      select: {
        slug: true,
        updatedAt: true,
        subject: { select: { slug: true } },
      },
    }),
  ]);
  return ["/", "/subjects", "/pricing"]
    .map((path) => ({ url: new URL(path, base).href }))
    .concat(
      subjects.map((s) => ({ url: new URL(`/subjects/${s.slug}`, base).href })),
      topics.map((t) => ({
        url: new URL(`/learn/${t.subject.slug}/${t.slug}`, base).href,
        lastModified: t.updatedAt,
      })),
    );
}
