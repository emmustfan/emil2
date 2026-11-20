import { getDb } from "../db";
import { normalizeAnswer } from "../exercises";
import { Prisma } from "../generated/prisma/client";
import { can, type ContentReader } from "../org";
import { assertCanViewGroupProgress, type GroupSubject } from "./access";
import { visibleTopicSQL } from "./queries";
import { snapshotReader } from "./snapshots";

type FirstAnswer = {
  id: string;
  topicId: string;
  topicTitle: string;
  stem: string;
  kind: "gap" | "question" | "video";
  correct: boolean | null;
  chosen: string[] | null;
  version: number | null;
  text: string | null;
};

export async function groupAnalysis(
  viewer: ContentReader | null | undefined,
  scope: GroupSubject,
) {
  return getDb().$transaction(
    async (db) => {
      await assertCanViewGroupProgress(viewer, scope, db);
      const { groupId, subjectId } = scope;
      const [pair, canEdit, answers] = await Promise.all([
        db.groupSubject.findUniqueOrThrow({
          where: { groupId_subjectId: scope },
          select: {
            group: { select: { name: true } },
            subject: { select: { title: true } },
          },
        }),
        can(viewer!, "content.edit", { subjectId }, db),
        db.$queryRaw<FirstAnswer[]>(Prisma.sql`
        WITH people AS (
          SELECT u.id FROM "GroupMember" m JOIN "User" u ON u.id=m."userId"
          WHERE m."groupId"=${groupId} AND m.status='ACTIVE' AND u.role='USER'
            AND u."deletedAt" IS NULL AND u."anonymizedAt" IS NULL
        ), topics AS (
          SELECT t.id,t.title FROM "Topic" t JOIN "Subject" s ON s.id=t."subjectId"
          WHERE t."subjectId"=${subjectId} AND ${visibleTopicSQL}
        ), gaps AS (
          SELECT g.id,t.id AS "topicId",t.title AS "topicTitle",g.sentence AS stem
          FROM "Gap" g JOIN topics t ON t.id=g."topicId" WHERE g."archivedAt" IS NULL
        ), questions AS (
          SELECT q.id,t.id AS "topicId",t.title AS "topicTitle",q.stem,
            CASE WHEN q."videoId" IS NULL THEN 'question' ELSE 'video' END AS kind
          FROM "Question" q JOIN topics t ON t.id=q."topicId"
          WHERE q."archivedAt" IS NULL AND q."publishedAt" IS NOT NULL
        ), first_gaps AS (
          SELECT a."gapId",a."isCorrect" AS correct,
            CASE WHEN cardinality(a."chosenValues")>0 THEN a."chosenValues" ELSE ARRAY[a.chosen] END AS chosen
          FROM "GapAnswer" a JOIN people p ON p.id=a."userId" JOIN gaps g ON g.id=a."gapId"
        ), first_questions AS (
          SELECT DISTINCT ON (q.id,r."userId") q.id,a."isCorrect" AS correct,
            a."chosenOptionIds" AS chosen,r."topicVersion" AS version,a."chosenText" AS text
          FROM questions q JOIN "QuestionAttempt" a ON a."questionId"=q.id JOIN "TestRun" r ON r.id=a."testRunId"
          JOIN people p ON p.id=r."userId"
          WHERE r."subjectId"=${subjectId}
          ORDER BY q.id,r."userId",a."createdAt",a.id
        )
        SELECT g.*,'gap' AS kind,a.correct,a.chosen,NULL::int AS version,NULL::text AS text
        FROM gaps g LEFT JOIN first_gaps a ON a."gapId"=g.id
        UNION ALL
        SELECT q.*,a.correct,a.chosen,a.version,a.text FROM questions q LEFT JOIN first_questions a ON a.id=q.id
      `),
      ]);
      const wrongQuestions = answers.filter(
        (a) => a.kind !== "gap" && a.correct === false && a.text === null,
      );
      const ids = [...new Set(wrongQuestions.map((a) => a.id))];
      const [questions, revisions] = await Promise.all([
        db.question.findMany({
          where: { id: { in: ids } },
          include: { topic: { select: { version: true } } },
        }),
        db.topicRevision.findMany({
          where: {
            topicId: { in: [...new Set(wrongQuestions.map((a) => a.topicId))] },
          },
        }),
      ]);
      const historical = snapshotReader(revisions);
      const current = new Map(questions.map((q) => [q.id, q]));
      const items = new Map<
        string,
        {
          id: string;
          topicId: string;
          topicTitle: string;
          stem: string;
          kind: FirstAnswer["kind"];
          total: number;
          correct: number;
          wrong: Map<string, { text: string; count: number }>;
        }
      >();
      for (const a of answers) {
        const key = `${a.kind}:${a.id}`;
        let item = items.get(key);
        if (!item) {
          item = {
            id: a.id,
            topicId: a.topicId,
            topicTitle: a.topicTitle,
            stem: a.stem,
            kind: a.kind,
            total: 0,
            correct: 0,
            wrong: new Map(),
          };
          items.set(key, item);
        }
        if (a.correct === null) continue;
        item.total++;
        if (a.correct) {
          item.correct++;
          continue;
        }
        const question = a.kind === "gap" ? undefined : current.get(a.id);
        const choices = question
          ? historical.question(
              question,
              a.version ?? question.topic.version,
              question.topic.version,
            ).options
          : [];
        const text =
          a.text ??
          [...(a.chosen ?? [])]
            .map((v) => choices.find((choice) => choice.id === v)?.text ?? v)
            .sort((x, y) => x.localeCompare(y, "ru"))
            .join(" · ");
        const answerKey = normalizeAnswer(text);
        const wrong = item.wrong.get(answerKey);
        if (wrong) wrong.count++;
        else item.wrong.set(answerKey, { text, count: 1 });
      }
      return {
        ...pair,
        canEdit,
        items: [...items.values()]
          .map(({ wrong, ...item }) => ({
            ...item,
            accuracy: item.total ? item.correct / item.total : null,
            wrong: [...wrong.values()]
              .sort(
                (a, b) =>
                  b.count - a.count || a.text.localeCompare(b.text, "ru"),
              )
              .slice(0, 3),
          }))
          .sort(
            (a, b) =>
              (a.accuracy ?? Infinity) - (b.accuracy ?? Infinity) ||
              b.total - a.total ||
              a.stem.localeCompare(b.stem, "ru"),
          ),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
