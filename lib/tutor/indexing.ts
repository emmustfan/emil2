import { randomUUID, createHash } from "node:crypto";
import { getDb } from "../db";
import { getEnv } from "../env";
import { createLLMProvider } from "../llm";
import { validateEmbeddings } from "../llm/http";
import type { LLMProvider } from "../llm/provider";
import { lock } from "../auth/session";
import { tutorSettings } from "./settings";
import { publishedBlocks, chunkBlocks } from "./chunks";
export function embeddingIdentity() {
  const env = getEnv();
  if (env.EMBEDDING_DIM !== 1536)
    throw new Error(
      "ContentChunk requires EMBEDDING_DIM=1536; migrate the vector column before changing it",
    );
  const model =
    env.LLM_PROVIDER === "mock" ? "mock-lexical-v1" : env.LLM_EMBEDDING_MODEL!;
  const endpoint =
    env.LLM_PROVIDER === "mock"
      ? "offline"
      : env.LLM_EMBEDDING_BASE_URL || env.LLM_BASE_URL!;
  return `${env.LLM_PROVIDER}:${model}:${createHash("sha256").update(endpoint).digest("hex").slice(0, 16)}:${env.EMBEDDING_DIM}`;
}
export type IndexJob = { topicId: string; subjectId: string; version: number };
export async function indexTopic(
  job: IndexJob,
  provider: LLMProvider = createLLMProvider(getEnv()),
) {
  const db = getDb(),
    settings = await tutorSettings(true),
    model = embeddingIdentity();
  const topic = await db.topic.findUnique({
    where: { id: job.topicId },
    include: {
      gap_topicId: { where: { archivedAt: null } },
      subject: { select: { status: true } },
    },
  });
  if (
    !topic ||
    topic.subjectId !== job.subjectId ||
    topic.status !== "PUBLISHED" ||
    topic.subject.status !== "PUBLISHED" ||
    topic.version !== job.version
  )
    return { indexed: false };
  const answers = new Map(
    topic.gap_topicId.map((g) => [
      g.gapKey,
      g.answerType === "SHORT_TEXT"
        ? (g.acceptedAnswers[0] ?? g.answer)
        : g.correctAnswers.length
          ? g.correctAnswers.join("; ")
          : g.answer,
    ]),
  );
  const chunks = chunkBlocks(
    publishedBlocks(topic.contentMd, answers),
    settings.chunkTargetTokens,
    settings.chunkMaxTokens,
  );
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += settings.embeddingBatchSize) {
    const batch = chunks.slice(i, i + settings.embeddingBatchSize);
    vectors.push(
      ...validateEmbeddings(
        await provider.embed(
          batch.map((c) => c.text),
          { signal: AbortSignal.timeout(settings.timeoutMs) },
        ),
        batch.length,
        1536,
      ),
    );
  }
  return db.$transaction(async (tx) => {
    await lock(tx, `content:topic:${topic.id}`);
    const current = await tx.topic.findUnique({
      where: { id: topic.id },
      select: {
        status: true,
        version: true,
        subject: { select: { status: true } },
      },
    });
    if (
      current?.status !== "PUBLISHED" ||
      current.subject.status !== "PUBLISHED" ||
      current.version !== job.version
    )
      return { indexed: false };
    await tx.contentChunk.deleteMany({ where: { topicId: topic.id } });
    for (const [i, c] of chunks.entries()) {
      const vector = JSON.stringify(vectors[i]);
      await tx.$executeRaw`INSERT INTO "ContentChunk" (id,"topicId","subjectId","blockKey",heading,text,"tokenCount","isFreeTopic",embedding,"topicVersion","embeddingModel") VALUES (${randomUUID()},${topic.id},${topic.subjectId},${c.blockKey},${c.heading},${c.text},${c.tokenCount},${topic.isFree},${vector}::vector,${topic.version},${model})`;
    }
    return { indexed: true, chunks: chunks.length };
  });
}
