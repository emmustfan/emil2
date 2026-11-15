import "dotenv/config";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { getDb } from "../../lib/db";
import { withSettingsSnapshot } from "../../lib/settings";
import { assertStudentPreview } from "../preview/student-profiles";
import { readTopicImage } from "../../lib/content/images";
import { progressSummary } from "../../lib/progress/summary";
export async function benchmarkProgress() {
  assertStudentPreview(process.env.DATABASE_URL, process.env.NODE_ENV);
  const db = getDb(),
    prefix = `benchmark-${randomUUID()}`,
    ids = Array.from({ length: 300 }, (_, i) => `${prefix}-${i}`),
    now = new Date();
  const admin = { id: `${prefix}-admin` };
  const { currentLegal } = await import("../../lib/auth/legal"),
    legal = await currentLegal();
  const demoImage = await db.topicImage.findFirstOrThrow({
    where: { topic: { subject: { slug: "progress-dental-demo" } } },
    select: { id: true },
  });
  const image = await readTopicImage(demoImage.id, null);
  if (!image.body.length) throw new Error("Preview learner image is empty");
  const topics = await db.topic.findMany({
    where: {
      status: "PUBLISHED",
      subject: { slug: { in: ["platform-demo", "learning-demo"] } },
    },
    include: { gap_topicId: { where: { archivedAt: null }, take: 1 } },
  });
  try {
    await db.user.create({
      data: {
        id: admin.id,
        name: "Администратор замера (демо)",
        role: "ADMIN",
        consentPdAt: now,
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
      },
    });
    await db.user.createMany({
      data: ids.map((id, i) => ({
        id,
        role: "USER",
        name: `${prefix} ${i}`,
        createdAt: new Date(+now - 30 * 86400000),
      })),
    });
    await db.topicProgress.createMany({
      data: ids.flatMap((userId, i) =>
        topics.map((t) => ({
          userId,
          topicId: t.id,
          gapsAnswered: 1,
          gapsCorrect: i % 2,
          testBestScore: 0.6 + (i % 3) * 0.2,
          completedAt: i % 3 === 0 ? now : null,
          lastOpenedAt: new Date(+now - (i % 20) * 86400000),
        })),
      ),
    });
    await db.gapAttempt.createMany({
      data: ids.flatMap((userId, i) =>
        topics.flatMap((t) =>
          t.gap_topicId.map((g) => ({
            userId,
            gapId: g.id,
            topicVersion: t.version,
            chosenValues: [i % 2 ? g.answer : g.distractors[0]],
            isCorrect: !!(i % 2),
            practice: false,
            createdAt: new Date(+now - (i % 20) * 86400000),
          })),
        ),
      ),
    });
    await db.card.createMany({
      data: ids.flatMap((userId) =>
        topics.flatMap((t) =>
          t.gap_topicId.map((g) => ({
            userId,
            subjectId: t.subjectId,
            topicId: t.id,
            gapId: g.id,
            source: "GAP" as const,
            dueAt: new Date(+now - 86400000),
          })),
        ),
      ),
    });
    return await withSettingsSnapshot(async () => {
      for (let i = 0; i < 3; i++) await progressSummary({ viewerId: admin.id });
      const times: number[] = [];
      let total = 0;
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        const result = await progressSummary({
          viewerId: admin.id,
          sort: i % 2 ? "completed" : "lastActivity",
          direction: "desc",
          filter: i % 3 ? "all" : "lagging",
        });
        times.push(performance.now() - start);
        total = Math.max(total, result.total);
      }
      times.sort((a, b) => a - b);
      return {
        demoStudents: 12,
        demoImageBytes: image.body.length,
        syntheticStudents: 300,
        totalStudents: total,
        samples: times.length,
        medianMs: Math.round(times[15] * 100) / 100,
        p95Ms:
          Math.round(times[Math.ceil(times.length * 0.95) - 1] * 100) / 100,
        maxMs: Math.round(times.at(-1)! * 100) / 100,
      };
    });
  } finally {
    await db.card.deleteMany({ where: { userId: { in: ids } } });
    await db.gapAttempt.deleteMany({ where: { userId: { in: ids } } });
    await db.topicProgress.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.user.deleteMany({ where: { id: admin.id } });
  }
}
console.log(JSON.stringify(await benchmarkProgress()));
await getDb().$disconnect();
