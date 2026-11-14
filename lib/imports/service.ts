import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { getEnv } from "../env";
import { createStorageDriver } from "../storage";
import {
  contentActor,
  contentWrite,
  authorizeSubject,
} from "../content/permissions";
import { ContentError } from "../content/errors";
import { getContentQueue, CONTENT_IMPORT_QUEUE } from "../content/jobs";
import { importInput, importLimits, sourceFormat } from "./policy";
import type { Prisma } from "../generated/prisma/client";
const missing = () => new ContentError("Задача импорта не найдена.", 404);
export async function enqueueImport(tx: Prisma.TransactionClient, id: string) {
  const queue = await getContentQueue();
  await queue.send(
    CONTENT_IMPORT_QUEUE,
    { id },
    {
      singletonKey: id,
      retryLimit: 2,
      retryDelay: 30,
      expireInSeconds: 900,
      db: {
        executeSql: async (text, values) => ({
          rows: await tx.$queryRawUnsafe<unknown[]>(text, ...(values ?? [])),
        }),
      },
    },
  );
}
export async function createImport(
  actorId: string,
  input: unknown,
  filename: string,
  body: Buffer,
) {
  const data = importInput.parse(input),
    limits = await importLimits();
  await authorizeSubject(data.subjectId, actorId);
  const format = sourceFormat(filename, body, limits.maxBytes),
    storage = createStorageDriver(getEnv());
  await getContentQueue();
  const fileKey = `import-${randomUUID()}`;
  await storage.put(fileKey, body);
  try {
    return await getDb().$transaction(async (tx) => {
      await contentWrite(tx, actorId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import:create:${actorId}`},0))`;
      await authorizeSubject(data.subjectId, actorId, tx);
      if (!(await tx.subject.count({ where: { id: data.subjectId } })))
        throw missing();
      if (
        data.sectionId &&
        !(await tx.section.count({
          where: { id: data.sectionId, subjectId: data.subjectId },
        }))
      )
        throw new ContentError("Раздел не найден в выбранном предмете.", 404);
      const recent = await tx.importJob.count({
          where: {
            createdById: actorId,
            createdAt: { gte: new Date(Date.now() - 3600000) },
          },
        }),
        active = await tx.importJob.count({
          where: {
            createdById: actorId,
            status: { in: ["queued", "processing"] },
          },
        });
      if (recent >= limits.requestsPerHour || active >= limits.maxConcurrent)
        throw new ContentError(
          "Дождитесь завершения текущих импортов или повторите через час: достигнут лимит загрузок.",
          429,
        );
      const job = await tx.importJob.create({
        data: {
          createdById: actorId,
          subjectId: data.subjectId,
          sectionId: data.sectionId,
          fileKey,
          format,
          status: "queued",
          topicIds: [],
          rightsConfirmedAt: new Date(),
        },
      });
      await enqueueImport(tx, job.id);
      return { id: job.id };
    });
  } catch (e) {
    await storage.remove(fileKey).catch(() => {});
    throw e;
  }
}
export async function getImport(actorId: string, id: string) {
  await contentActor(actorId);
  const row = await getDb().importJob.findUnique({ where: { id } });
  if (!row) throw missing();
  await authorizeSubject(row.subjectId, actorId);
  const topics = await getDb().topic.findMany({
    where: { id: { in: row.topicIds }, subjectId: row.subjectId },
    select: { id: true, title: true, status: true },
  });
  return {
    id: row.id,
    subjectId: row.subjectId,
    status: row.status,
    stage: row.stage,
    error: row.error,
    partsDone: row.partsDone,
    partsTotal: row.partsTotal,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    topics,
  };
}
export async function listImports(actorId: string, subjectId?: string) {
  const actor = await contentActor(actorId);
  if (subjectId) await authorizeSubject(subjectId, actorId);
  const rows = await getDb().importJob.findMany({
    where: {
      ...(subjectId ? { subjectId } : {}),
      ...(actor?.role === "EDITOR"
        ? {
            subject: { teachingAssignments: { some: { teacherId: actor.id } } },
          }
        : {}),
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return Promise.all(rows.map((row) => getImport(actorId, row.id)));
}
export type ImportDTO = Awaited<ReturnType<typeof getImport>>;
