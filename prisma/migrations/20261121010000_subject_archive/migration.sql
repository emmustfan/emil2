ALTER TABLE "Subject"
    ADD COLUMN "archivedAt" TIMESTAMP(3),
    ADD CONSTRAINT "Subject_archived_status_check"
    CHECK ("archivedAt" IS NULL OR "status" = 'DRAFT');
