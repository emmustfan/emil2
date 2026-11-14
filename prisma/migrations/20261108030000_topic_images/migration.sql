CREATE TABLE "TopicImage" (
  "id" TEXT PRIMARY KEY,
  "topicId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "bytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TopicImage_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TopicImage_storageKey_key" ON "TopicImage"("storageKey");
CREATE INDEX "TopicImage_topicId_idx" ON "TopicImage"("topicId");
