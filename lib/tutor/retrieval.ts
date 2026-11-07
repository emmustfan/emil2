import { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { getEnv } from "../env";
import { hasAccess } from "../access";
import { ContentError } from "../content/errors";
import { lessonHref } from "../lessons/catalog";
import type { Actor } from "../lessons/types";
import type { LLMProvider } from "../llm/provider";
import { validateEmbeddings } from "../llm/http";
import { terms } from "../llm/tokens";
import { embeddingIdentity } from "./indexing";
import type { TutorSettings } from "./settings";
import type { Source } from "./types";
export async function retrieve(
  question: string,
  scope: { subjectId: string; topicId: string | null },
  actor: Actor,
  provider: LLMProvider,
  settings: TutorSettings,
  signal: AbortSignal,
): Promise<Source[]> {
  const env = getEnv(),
    model = embeddingIdentity();
  const paid = await hasAccess(actor.userId ?? null, {
    subjectId: scope.subjectId,
    isFree: false,
  });
  const topics = await getDb().topic.findMany({
    where: {
      subjectId: scope.subjectId,
      status: "PUBLISHED",
      subject: { status: "PUBLISHED" },
      ...(scope.topicId ? { id: scope.topicId } : {}),
      ...(paid ? {} : { isFree: true }),
    },
    select: { id: true, version: true },
  });
  if (!topics.length) return [];
  const ready = await getDb().contentChunk.count({
    where: {
      embeddingModel: model,
      OR: topics.map((t) => ({ topicId: t.id, topicVersion: t.version })),
    },
  });
  if (!ready)
    throw new ContentError(
      "Материалы ещё готовятся для тьютора. Попробуйте через минуту.",
      503,
    );
  const [embedding] = validateEmbeddings(
    await provider.embed([question], { signal }),
    1,
    1536,
  );
  signal.throwIfAborted();
  const vector = JSON.stringify(embedding);
  const guestScope = !actor.userId
    ? Prisma.sql`AND t.id=${scope.topicId}`
    : Prisma.empty;
  const access = paid ? Prisma.empty : Prisma.sql`AND t."isFree"=true`;
  const rows = await getDb().$queryRaw<
    (Omit<Source, "n" | "href"> & {
      subjectSlug: string;
      topicSlug: string;
      similarity: number;
    })[]
  >(Prisma.sql`
    SELECT c.text,c."topicId",c."topicVersion",c."blockKey",c.heading,t.title AS "topicTitle",s.slug AS "subjectSlug",t.slug AS "topicSlug",1-(c.embedding <=> ${vector}::vector) AS similarity
    FROM "ContentChunk" c JOIN "Topic" t ON t.id=c."topicId" JOIN "Subject" s ON s.id=t."subjectId"
    WHERE t."subjectId"=${scope.subjectId} AND c."subjectId"=t."subjectId" AND t.status='PUBLISHED' AND s.status='PUBLISHED'
      AND c."topicVersion"=t.version AND c."embeddingModel"=${model} AND c.embedding IS NOT NULL ${access} ${guestScope}
      AND 1-(c.embedding <=> ${vector}::vector)>=${env.LLM_PROVIDER === "mock" ? 0 : settings.minSimilarity}
    ORDER BY c.embedding <=> ${vector}::vector,c.id
    LIMIT ${Math.min(100, Math.ceil(settings.topK * settings.candidateMultiplier))}`);
  const words = terms(question);
  const selected = rows
    .filter(
      (r) =>
        env.LLM_PROVIDER !== "mock" ||
        words.some((w) => terms(r.text).includes(w)),
    )
    .sort(
      (a, b) =>
        b.similarity +
        (b.topicId === scope.topicId ? settings.topicBonus : 0) -
        (a.similarity +
          (a.topicId === scope.topicId ? settings.topicBonus : 0)),
    )
    .slice(0, settings.topK);
  return selected.map((r, i) => ({
    n: i + 1,
    topicId: r.topicId,
    topicVersion: r.topicVersion,
    blockKey: r.blockKey,
    heading: r.heading,
    topicTitle: r.topicTitle,
    href: lessonHref(r.subjectSlug, r.topicSlug) + `#b-${r.blockKey}`,
    text: r.text,
  }));
}
