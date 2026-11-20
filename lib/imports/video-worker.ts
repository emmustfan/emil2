import { spendSummary, meterUsage } from "../monitoring/usage";
import type { Prisma, ImportJob } from "../generated/prisma/client";
import { getDb } from "../db";
import { getEnv } from "../env";
import { decodeSetting } from "../settings/defaults";
import { assertCan, lockContentStaff } from "../org";
import { lockTopicForChange } from "../content/locks";
import { ContentError } from "../content/errors";
import { MAX_MARKDOWN_CHARS, parseTopic } from "../content/parse";
import {
  stabilizeGapIds,
  existingGapIdentities,
} from "../content/gap-identity";
import { gapExercisesSchema } from "../exercises";
import { extractIsolated } from "./extractor";
import type { SourceFormat } from "./policy";
import { parseSubtitles } from "./subtitles";
import { generateVideoDraft } from "./video-draft";
import type { LLMProvider } from "../llm/provider";

async function importVideo(db: Prisma.TransactionClient, job: ImportJob) {
  const video =
    job.videoId &&
    (await db.videoLecture.findFirst({
      where: {
        id: job.videoId,
        archivedAt: null,
        updatedAt: job.videoRevision!,
        topic: { subjectId: job.subjectId },
      },
    }));
  if (!video)
    throw new ContentError(
      "Видео изменилось во время импорта. Загрузите исходник заново.",
    );
  return video;
}

export async function processVideoImport(
  job: ImportJob,
  token: string,
  body: Buffer,
  provider: LLMProvider,
) {
  const db = getDb();
  const video = await importVideo(db, job);
  const key = "video.subtitleMaxChars";
  const row = await db.appSetting.findUnique({ where: { key } });
  const maxChars = decodeSetting(key, row?.value);
  const source =
    job.format === "subtitles"
      ? { cues: parseSubtitles(body, maxChars), text: "" }
      : {
          cues: [],
          text: await extractIsolated(
            body,
            job.format as SourceFormat,
            maxChars,
          ),
        };
  const running = await db.importJob.updateMany({
    where: { id: job.id, status: "processing", runToken: token },
    data: { stage: "generating", partsTotal: 1 },
  });
  if (!running.count) return;
  await assertCan(job.createdById, "content.edit", {
    subjectId: job.subjectId,
  });
  const credentials = await db.videoLecture.findMany({
    where: { topicId: video.topicId },
    select: { accessKey: true, externalId: true },
  });
  const env = getEnv();
  const model = env.LLM_CHAT_MODEL ?? "mock-import";
  if (
    env.LLM_PROVIDER !== "mock" &&
    env.LLM_DAILY_BUDGET_RUB > 0 &&
    (await spendSummary()).estimatedRub >= env.LLM_DAILY_BUDGET_RUB
  )
    throw new ContentError(
      "Дневной бюджет ИИ исчерпан. Повторите импорт завтра.",
    );
  const draft = await generateVideoDraft(
    provider,
    source,
    video,
    model,
    credentials,
  );
  if (env.LLM_PROVIDER === "mock") await meterUsage("import", model, 0, 0);
  await db.$transaction(
    async (tx) => {
      await lockContentStaff(tx, job.createdById);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import:job:${job.id}`},0))`;
      await lockTopicForChange(tx, video.topicId);
      const current = await tx.importJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      if (current.status !== "processing" || current.runToken !== token) return;
      await importVideo(tx, current);
      await assertCan(
        job.createdById,
        "content.edit",
        { subjectId: job.subjectId },
        tx,
      );
      const topic = await tx.topic.findUniqueOrThrow({
        where: { id: video.topicId },
        include: {
          gap_topicId: {
            select: { gapKey: true, sentence: true, answer: true },
          },
        },
      });
      const markdown =
        `${topic.draftContentMd.trimEnd()}\n\n## Конспект лекции\n\n${draft.summaryMd}`.trim();
      if (
        markdown.length > MAX_MARKDOWN_CHARS ||
        parseTopic(markdown).errors.length
      )
        throw new ContentError(
          "Конспект не поместился в черновик или в текущем тексте есть ошибки разметки.",
        );
      const stable = stabilizeGapIds(
        markdown,
        gapExercisesSchema.parse(topic.draftGapExercises),
        existingGapIdentities(topic.gap_topicId),
      );
      await tx.topic.update({
        where: { id: topic.id },
        data: {
          draftContentMd: stable.contentMd,
          draftGapExercises: stable.gapExercises,
          draftState: "DRAFT",
          draftReviewed: false,
          draftUpdatedAt: new Date(),
          draftUpdatedById: job.createdById,
          editRevision: { increment: 1 },
          ...(topic.version === 0 ? { needsExpertReview: true } : {}),
        },
      });
      if (draft.questions.length)
        await tx.question.createMany({
          data: draft.questions.map((q) => ({ ...q, topicId: topic.id })),
        });
      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: "done",
          stage: "done",
          partsDone: 1,
          topicIds: [topic.id],
          report: draft.report,
          finishedAt: new Date(),
          leaseUntil: null,
          runToken: null,
        },
      });
    },
    { timeout: 30000 },
  );
}
