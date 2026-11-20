-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "atSec" INTEGER,
ADD COLUMN     "sourceQuote" TEXT,
ADD COLUMN     "sourceSec" INTEGER,
ADD COLUMN     "sourceVideoId" TEXT,
ADD COLUMN     "videoId" TEXT;

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "report" JSONB,
ADD COLUMN     "videoId" TEXT,
ADD COLUMN     "videoRevision" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VideoLecture" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'rutube',
    "externalId" TEXT NOT NULL,
    "accessKey" TEXT,
    "durationSec" INTEGER,
    "patientConsentAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "VideoLecture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProgress" (
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "watchedRanges" JSONB NOT NULL,
    "watchedSec" INTEGER NOT NULL DEFAULT 0,
    "lastPositionSec" INTEGER NOT NULL DEFAULT 0,
    "selfReported" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProgress_pkey" PRIMARY KEY ("userId","videoId")
);

-- CreateIndex
CREATE INDEX "VideoLecture_topicId_idx" ON "VideoLecture"("topicId");

-- CreateIndex
CREATE INDEX "VideoProgress_videoId_idx" ON "VideoProgress"("videoId");

-- CreateIndex
CREATE INDEX "Question_videoId_idx" ON "Question"("videoId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "VideoLecture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "VideoLecture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoLecture" ADD CONSTRAINT "VideoLecture_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoLecture" ADD CONSTRAINT "VideoLecture_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProgress" ADD CONSTRAINT "VideoProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProgress" ADD CONSTRAINT "VideoProgress_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "VideoLecture"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A single video attempt per learner, lesson and published revision.
CREATE UNIQUE INDEX "TestRun_video_topic_version_user"
  ON "TestRun" ("topicId", "topicVersion", "userId") WHERE mode = 'VIDEO';

ALTER TABLE "Question" ADD CONSTRAINT "Question_video_timing_check"
  CHECK (("videoId" IS NULL AND "atSec" IS NULL) OR
    ("videoId" IS NOT NULL AND "atSec" IS NOT NULL AND "atSec" >= 0 AND NOT "isDiagnostic"));
