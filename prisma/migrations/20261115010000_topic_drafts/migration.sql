CREATE TYPE "DraftState" AS ENUM ('CLEAN', 'DRAFT', 'REVIEW');

ALTER TABLE "Topic"
  ADD COLUMN "draftState" "DraftState" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "draftTitle" TEXT,
  ADD COLUMN "draftContentMd" TEXT,
  ADD COLUMN "draftGapExercises" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "draftReadingMinutes" INTEGER,
  ADD COLUMN "draftReferencesMd" TEXT,
  ADD COLUMN "draftAuthorName" TEXT,
  ADD COLUMN "draftReviewerName" TEXT,
  ADD COLUMN "draftReviewed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "draftUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "draftUpdatedById" TEXT;

UPDATE "Topic" SET
  "draftState" = CASE "status" WHEN 'PUBLISHED' THEN 'CLEAN'::"DraftState" WHEN 'REVIEW' THEN 'REVIEW'::"DraftState" ELSE 'DRAFT'::"DraftState" END,
  "draftTitle" = "title", "draftContentMd" = "contentMd",
  "draftGapExercises" = "gapExercises", "draftReadingMinutes" = "readingMinutes",
  "draftReferencesMd" = "referencesMd", "draftAuthorName" = "authorName",
  "draftReviewerName" = "reviewerName", "draftReviewed" = NOT "needsExpertReview",
  "draftUpdatedAt" = "updatedAt";

ALTER TABLE "Topic" ALTER COLUMN "draftTitle" SET NOT NULL, ALTER COLUMN "draftContentMd" SET NOT NULL;

-- Older trusted seeds could publish a version without a timestamp. Preserve
-- visibility of their questions using the original creation timestamp.
UPDATE "Topic" SET "publishedAt" = "createdAt"
WHERE "publishedAt" IS NULL AND ("version" > 0 OR "status" = 'PUBLISHED');

ALTER TABLE "Question"
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "draft" JSONB,
  ADD COLUMN "draftDeleted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Question" q SET "publishedAt" = t."publishedAt"
FROM "Topic" t WHERE q."topicId" = t.id AND (t."status" = 'PUBLISHED' OR t."version" > 0);

CREATE TABLE "TopicRevision" (
  "id" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "contentMd" TEXT NOT NULL,
  "gapExercises" JSONB NOT NULL,
  "questions" JSONB NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedById" TEXT,
  CONSTRAINT "TopicRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TopicRevision_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TopicRevision_topicId_version_key" ON "TopicRevision"("topicId", "version");

INSERT INTO "TopicRevision" ("id", "topicId", "version", "title", "contentMd", "gapExercises", "questions", "publishedAt")
SELECT 'migration-' || md5(t.id || ':' || t.version::text), t.id, t.version,
  t.title, t."contentMd", t."gapExercises",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', q.id, 'topicId', q."topicId", 'answerType', q."answerType",
    'stem', q.stem, 'options', q.options, 'correctOptionIds', q."correctOptionIds",
    'acceptedAnswers', q."acceptedAnswers", 'explanation', q.explanation,
    'sourceBlockKey', q."sourceBlockKey", 'isDiagnostic', q."isDiagnostic", 'order', q."order"
  ) ORDER BY q."order", q.id) FROM "Question" q WHERE q."topicId" = t.id AND q."archivedAt" IS NULL), '[]'::jsonb),
  t."publishedAt"
FROM "Topic" t WHERE t.version > 0;

UPDATE "Topic" SET "status" = 'DRAFT' WHERE "status" = 'REVIEW';
