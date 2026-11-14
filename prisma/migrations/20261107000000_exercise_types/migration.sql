CREATE TYPE "AnswerType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_TEXT');
ALTER TABLE "Topic" ADD COLUMN "gapExercises" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Gap" ADD COLUMN "answerType" "AnswerType" NOT NULL DEFAULT 'SINGLE_CHOICE', ADD COLUMN "correctAnswers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "acceptedAnswers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "explanation" TEXT NOT NULL DEFAULT '';
UPDATE "Gap" SET "correctAnswers"=ARRAY["answer"];
ALTER TABLE "Question" ADD COLUMN "answerType" "AnswerType" NOT NULL DEFAULT 'SINGLE_CHOICE', ADD COLUMN "acceptedAnswers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- History is preserved as feedback snapshots; no old grades or identities change.
ALTER TABLE "GapAnswer" ADD COLUMN "chosenValues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "correctValues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "explanation" TEXT NOT NULL DEFAULT '';
UPDATE "GapAnswer" ga SET "chosenValues"=ARRAY[ga."chosen"], "correctValues"=ARRAY[g."answer"] FROM "Gap" g WHERE ga."gapId"=g."id";
ALTER TABLE "QuestionAttempt" ADD COLUMN "chosenText" TEXT;
