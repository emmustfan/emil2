import type { Prisma } from "../generated/prisma/client";

/** Used by trusted seeds/imports too: initialize both copies, never guess at read time. */
export function initialTopicDraft(
  input: {
    title: string;
    contentMd: string;
    gapExercises?: Prisma.InputJsonValue;
    readingMinutes?: number | null;
    referencesMd?: string | null;
    authorName?: string | null;
    reviewerName?: string | null;
    needsExpertReview?: boolean;
    status?: string;
  },
  actorId?: string,
) {
  return {
    draftState:
      input.status === "PUBLISHED"
        ? ("CLEAN" as const)
        : input.status === "REVIEW"
          ? ("REVIEW" as const)
          : ("DRAFT" as const),
    draftTitle: input.title,
    draftContentMd: input.contentMd,
    draftGapExercises: input.gapExercises ?? {},
    draftReadingMinutes: input.readingMinutes ?? null,
    draftReferencesMd: input.referencesMd ?? null,
    draftAuthorName: input.authorName ?? null,
    draftReviewerName: input.reviewerName ?? null,
    draftReviewed: input.needsExpertReview === false,
    draftUpdatedAt: new Date(),
    draftUpdatedById: actorId ?? null,
  };
}

/** Trusted fixtures/imports create both copies explicitly. Editorial updates use draft fields only. */
export function withTopicDraft(
  input: Omit<
    Prisma.TopicUncheckedCreateInput,
    "draftTitle" | "draftContentMd"
  >,
  actorId?: string,
): Prisma.TopicUncheckedCreateInput {
  return {
    ...input,
    ...initialTopicDraft(
      {
        ...input,
        gapExercises: input.gapExercises as Prisma.InputJsonValue | undefined,
      },
      actorId,
    ),
  };
}

/** Only trusted preview seeds: retain version 1 for lessons created already published. */
export async function recordInitialTopicRevision(
  db: Prisma.TransactionClient,
  topicId: string,
) {
  const topic = await db.topic.findUniqueOrThrow({
    where: { id: topicId },
    include: {
      question_topicId: {
        where: { archivedAt: null, publishedAt: { not: null } },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!topic.version || !topic.publishedAt)
    throw new Error(
      "A published fixture must have a version and publication date",
    );
  const questions = topic.question_topicId.map(
    ({
      id,
      topicId,
      answerType,
      acceptedAnswers,
      stem,
      options,
      correctOptionIds,
      explanation,
      sourceBlockKey,
      isDiagnostic,
      order,
    }) => ({
      id,
      topicId,
      answerType,
      acceptedAnswers,
      stem,
      options,
      correctOptionIds,
      explanation,
      sourceBlockKey,
      isDiagnostic,
      order,
    }),
  );
  await db.topicRevision.upsert({
    where: { topicId_version: { topicId, version: topic.version } },
    update: {},
    create: {
      topicId,
      version: topic.version,
      title: topic.title,
      contentMd: topic.contentMd,
      gapExercises: topic.gapExercises as Prisma.InputJsonValue,
      questions: questions as Prisma.InputJsonValue,
      publishedAt: topic.publishedAt,
    },
  });
}
