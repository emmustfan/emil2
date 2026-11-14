-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "editRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "editRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "editRevision" INTEGER NOT NULL DEFAULT 0;

