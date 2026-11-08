import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { getEnv } from "../env";
import { createStorageDriver } from "../storage";
import { createLLMProvider } from "../llm";
import type { LLMProvider } from "../llm/provider";
import { contentWrite, authorizeSubject } from "../content/permissions";
import { hasCurrentConsent } from "../auth/legal";
import { ContentError } from "../content/errors";
import { headingSlug } from "../content/slug";
import { importLimits, type SourceFormat } from "./policy";
import { extractIsolated } from "./extractor";
import { generateDraft, splitSource, type ImportDraft } from "./draft";
import { enqueueImport } from "./service";
async function locked<T>(
  id: string,
  fn: (
    tx: import("../generated/prisma/client").Prisma.TransactionClient,
  ) => Promise<T>,
) {
  return getDb().$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import:job:${id}`},0))`;
      return fn(tx);
    },
    { timeout: 30000 },
  );
}
async function removeSource(id: string) {
  const job = await getDb().importJob.findUnique({ where: { id } });
  if (!job || job.sourceDeletedAt || !["done", "failed"].includes(job.status))
    return;
  try {
    await createStorageDriver(getEnv()).remove(job.fileKey);
    await getDb().importJob.update({
      where: { id },
      data: { sourceDeletedAt: new Date() },
    });
  } catch {
    /* Retried by the minute janitor; never log source text or key. */
  }
}
export async function processImport(id: string, provider?: LLMProvider) {
  const token = randomUUID();
  const job = await locked(id, async (tx) => {
    const row = await tx.importJob.findUnique({ where: { id } });
    if (
      !row ||
      !["queued", "processing"].includes(row.status) ||
      (row.leaseUntil && row.leaseUntil > new Date())
    )
      return null;
    if (row.attempts >= 2 || !row.rightsConfirmedAt) {
      await tx.importJob.update({
        where: { id },
        data: {
          status: "failed",
          stage: "failed",
          error: "Импорт прерван. Проверьте файл и загрузите его заново.",
          finishedAt: new Date(),
        },
      });
      return null;
    }
    return tx.importJob.update({
      where: { id },
      data: {
        status: "processing",
        stage: "extracting",
        runToken: token,
        attempts: { increment: 1 },
        leaseUntil: new Date(Date.now() + 900000),
        partsDone: 0,
        error: null,
      },
    });
  });
  if (!job) {
    await removeSource(id);
    return;
  }
  try {
    // Recheck assignments before the first external call and again at final commit.
    await authorizeSubject(job.subjectId, job.createdById);
    const actor = await getDb().user.findUniqueOrThrow({
      where: { id: job.createdById },
    });
    if (!(await hasCurrentConsent(actor)))
      throw new ContentError(
        "Автору импорта нужно обновить согласие и загрузить материал заново.",
      );
    const limits = await importLimits(true),
      env = getEnv(),
      storage = createStorageDriver(env);
    const body = await storage.get(job.fileKey);
    if (body.length > limits.maxBytes)
      throw new ContentError("Файл превышает допустимый размер.");
    const source = await extractIsolated(
        body,
        job.format as SourceFormat,
        limits.maxTextChars,
      ),
      parts = splitSource(source, limits.partChars, limits.maxParts),
      drafts: ImportDraft[] = [];
    await getDb().importJob.updateMany({
      where: { id, runToken: token, status: "processing" },
      data: { stage: "generating", partsTotal: parts.length },
    });
    const llm = provider ?? createLLMProvider(env);
    for (const part of parts) {
      await authorizeSubject(job.subjectId, job.createdById);
      drafts.push(
        await generateDraft(llm, part, env.LLM_CHAT_MODEL ?? "mock-import"),
      );
      const changed = await getDb().importJob.updateMany({
        where: { id, runToken: token, status: "processing" },
        data: { partsDone: drafts.length },
      });
      if (!changed.count) return;
    }
    await getDb().$transaction(
      async (tx) => {
        await contentWrite(tx, job.createdById);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import:job:${id}`},0))`;
        const current = await tx.importJob.findUniqueOrThrow({ where: { id } });
        if (current.status !== "processing" || current.runToken !== token)
          return;
        await authorizeSubject(job.subjectId, job.createdById, tx);
        if (
          job.sectionId &&
          !(await tx.section.count({
            where: { id: job.sectionId, subjectId: job.subjectId },
          }))
        )
          throw new ContentError("Раздел исходного импорта больше недоступен.");
        const topicIds: string[] = [];
        for (const [i, draft] of drafts.entries()) {
          const topic = await tx.topic.create({
            data: {
              subjectId: job.subjectId,
              sectionId: job.sectionId,
              title: draft.title,
              slug: `${headingSlug(draft.title).slice(0, 40)}-${id}-${i + 1}`,
              order: 0,
              isFree: false,
              contentMd: draft.contentMd,
              status: "DRAFT",
              aiGenerated: true,
              needsExpertReview: true,
              reviewedAt: null,
              authorName: null,
              reviewerName: null,
              referencesMd: null,
              question_topicId: { create: draft.questions },
            },
          });
          topicIds.push(topic.id);
        }
        await tx.importJob.update({
          where: { id },
          data: {
            status: "done",
            stage: "done",
            topicIds,
            finishedAt: new Date(),
            leaseUntil: null,
            runToken: null,
          },
        });
      },
      { timeout: 30000 },
    );
  } catch (error) {
    // Provider/decoder error bodies may contain source text or secrets; expose only known messages.
    const message =
      error instanceof ContentError
        ? error.message
        : "Не удалось подготовить черновик. Проверьте файл и настройку ИИ, затем загрузите материал заново.";
    await getDb().importJob.updateMany({
      where: { id, runToken: token, status: "processing" },
      data: {
        status: "failed",
        stage: "failed",
        error: message,
        finishedAt: new Date(),
        leaseUntil: null,
        runToken: null,
      },
    });
  } finally {
    await removeSource(id);
  }
}
export async function importTick() {
  const db = getDb();
  const jobs = await db.importJob.findMany({
    where: {
      OR: [
        { status: "queued" },
        { status: "processing", leaseUntil: { lte: new Date() } },
        { status: "processing", leaseUntil: null },
      ],
    },
    select: { id: true },
    take: 100,
  });
  for (const job of jobs)
    await db.$transaction((tx) => enqueueImport(tx, job.id));
  const finished = await db.importJob.findMany({
    where: { status: { in: ["done", "failed"] }, sourceDeletedAt: null },
    select: { id: true },
    take: 100,
  });
  for (const job of finished) await removeSource(job.id);
}
