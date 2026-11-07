ALTER TABLE "DemoSession" ADD COLUMN "flow" JSONB;
ALTER TABLE "Event" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Event_dedupeKey_key" ON "Event"("dedupeKey");
ALTER TABLE "Event" DROP CONSTRAINT "Event_userId_fkey";
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "diagnostic" JSONB;
