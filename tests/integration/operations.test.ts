import { afterAll, it, expect, vi } from "vitest";
import sitemap from "../../app/sitemap";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../lib/generated/prisma/client";
import { getDb } from "../../lib/db";
import { recordUsage, spendSummary } from "../../lib/monitoring/usage";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { loadLesson } from "../../lib/lessons/service";
import {
  createLessonFixture,
  cleanupLessonFixture,
} from "../helpers/lesson-fixture";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
const db = getDb();
afterAll(async () => {
  await db.$disconnect();
});
it("keeps an anonymous immutable usage estimate and reports missing provider usage separately", async () => {
  const keys = [
      "llm.inputRubPerMillion",
      "llm.outputRubPerMillion",
      "llm.embeddingRubPerMillion",
    ],
    old = await db.appSetting.findMany({ where: { key: { in: keys } } }),
    model = `fixture-${randomUUID()}`,
    start = new Date();
  try {
    for (const key of keys)
      await db.appSetting.upsert({
        where: { key },
        create: { key, value: 100 },
        update: { value: 100 },
      });
    await recordUsage("import", model, 1000000, 2000000);
    await recordUsage("tutor", model, null, null);
    const rows = await db.llmUsage.findMany({ where: { model } });
    expect(rows).toHaveLength(2);
    expect(Number(rows[0].estimatedCostRub)).toBe(300);
    expect(rows[0]).not.toHaveProperty("userId");
    expect(rows[0]).not.toHaveProperty("prompt");
    const summary = await spendSummary(start, new Date(Date.now() + 1000));
    expect(summary.estimatedRub).toBeGreaterThanOrEqual(300);
    expect(summary.unknown).toBeGreaterThanOrEqual(1);
    await db.appSetting.update({
      where: { key: keys[0] },
      data: { value: 500 },
    });
    expect(
      Number(
        (
          await db.llmUsage.findFirstOrThrow({
            where: { model, kind: "import" },
          })
        ).estimatedCostRub,
      ),
    ).toBe(300);
  } finally {
    await db.llmUsage.deleteMany({ where: { model } });
    await db.appSetting.deleteMany({ where: { key: { in: keys } } });
    for (const row of old)
      await db.appSetting.create({
        data: {
          ...row,
          value: row.value === null ? Prisma.JsonNull : row.value,
        },
      });
  }
});

it("allows simultaneous lesson readers while an exclusive content edit waits", async () => {
  const f = await createLessonFixture("read-lock");
  const guest = await db.demoSession.create({
    data: { anonId: randomUUID(), stepsCompleted: [] },
  });
  let writer: Promise<unknown> | undefined;
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`content:topic:${f.free.id}`},0))`;
        // This used to wait for the first reader because lesson loads used an exclusive lock.
        const result = await loadLesson(f.free.id, { demoSessionId: guest.id });
        expect(result.locked).toBe(false);
        writer = db.$transaction(async (other) => {
          await other.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`content:topic:${f.free.id}`},0))`;
          return "writer-acquired";
        });
        expect(
          await Promise.race([
            writer,
            new Promise((ok) => setTimeout(() => ok("waiting"), 80)),
          ]),
        ).toBe("waiting");
      },
      { timeout: 5000 },
    );
    expect(await writer).toBe("writer-acquired");
  } finally {
    await cleanupLessonFixture(f, [guest.id]);
  }
});

it("sitemap exposes only reviewed free publications on an explicitly indexed production site", async () => {
  const f = await createLessonFixture("sitemap");
  try {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_INDEXING", "true");
    vi.stubEnv("APP_URL", "https://learn.example.test");
    const urls = (await sitemap()).map((item) => item.url);
    expect(urls).toContain(
      `https://learn.example.test/learn/${f.subject.slug}/${f.free.slug}`,
    );
    expect(urls).not.toContain(
      `https://learn.example.test/learn/${f.subject.slug}/${f.paid.slug}`,
    );
    await db.topic.update({
      where: { id: f.free.id },
      data: { needsExpertReview: true },
    });
    expect((await sitemap()).map((item) => item.url)).not.toContain(
      `https://learn.example.test/learn/${f.subject.slug}/${f.free.slug}`,
    );
    await db.subject.update({
      where: { id: f.subject.id },
      data: { status: "DRAFT" },
    });
    expect(
      (await sitemap()).some((item) => item.url.includes(f.subject.slug)),
    ).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(await sitemap()).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    await cleanupLessonFixture(f);
  }
});
