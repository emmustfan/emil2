// Run on a populated pre-12A database copy. Fixtures and migration always roll back.
import "dotenv/config";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  assert.equal(
    (await db.query(`SELECT to_regclass('"GapAttempt"') AS name`)).rows[0].name,
    null,
    "Use a pre-12A database copy",
  );
  const prefix = `migration12a-${randomUUID()}`,
    user = prefix + "-user",
    subject = prefix + "-subject",
    topic = prefix + "-topic",
    demo = prefix + "-demo";
  await db.query(`INSERT INTO "User" (id) VALUES ($1)`, [user]);
  await db.query(
    `INSERT INTO "Subject" (id,slug,title,"shortDescription",courses,"updatedAt") VALUES ($1,$1,'Synthetic','Synthetic',ARRAY[1],now())`,
    [subject],
  );
  await db.query(
    `INSERT INTO "Topic" (id,"subjectId",slug,title,"contentMd","draftTitle","draftContentMd",version,"updatedAt") VALUES ($1,$2,'fixture','Synthetic','Synthetic','Synthetic','Synthetic',3,now())`,
    [topic, subject],
  );
  await db.query(
    `INSERT INTO "DemoSession" (id,"anonId","stepsCompleted") VALUES ($1,$1,ARRAY[]::int[])`,
    [demo],
  );
  for (const [suffix, type] of [
    ["choice", "SINGLE_CHOICE"],
    ["text", "SHORT_TEXT"],
  ]) {
    const gap = prefix + "-" + suffix;
    await db.query(
      `INSERT INTO "Gap" (id,"topicId","gapKey","blockKey","order",answer,distractors,sentence,"answerType") VALUES ($1,$2,$1,'block',0,'answer',ARRAY['other'],'Synthetic ____',$3)`,
      [gap, topic, type],
    );
    await db.query(
      `INSERT INTO "GapAnswer" (id,"gapId","userId",chosen,"chosenValues","isCorrect","createdAt") VALUES ($1,$2,$3,'answer',CASE WHEN $4='text' THEN ARRAY['typed answer'] ELSE ARRAY[]::text[] END,true,'2026-11-01')`,
      [gap + "-first", gap, user, suffix],
    );
  }
  await db.query(
    `INSERT INTO "GapAnswer" (id,"gapId","demoSessionId",chosen,"isCorrect") VALUES ($1,$2,$3,'other',false)`,
    [prefix + "-guest", prefix + "-choice", demo],
  );
  await db.query(
    `INSERT INTO "Card" (id,"userId","subjectId","topicId","gapId",source,"dueAt") VALUES ($1,$2,$3,$4,$5,'GAP',now())`,
    [prefix + "-card", user, subject, topic, prefix + "-choice"],
  );
  async function counts() {
    const result = {};
    for (const table of [
      "GapAnswer",
      "Card",
      "QuestionAttempt",
      "TopicProgress",
      "Payment",
    ])
      result[table] = Number(
        (await db.query(`SELECT count(*) FROM "${table}"`)).rows[0].count,
      );
    return result;
  }
  const before = await counts(),
    expected = Number(
      (
        await db.query(
          `SELECT count(*) FROM "GapAnswer" WHERE "userId" IS NOT NULL`,
        )
      ).rows[0].count,
    );
  await db.query(
    await readFile(
      new URL(
        "../../prisma/migrations/20261115020000_student_progress/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const after = await counts();
  assert.deepEqual(after, before);
  assert.equal(
    Number((await db.query(`SELECT count(*) FROM "GapAttempt"`)).rows[0].count),
    expected,
  );
  assert.equal(
    Number(
      (
        await db.query(
          `SELECT count(*) FROM "GapAttempt" a JOIN "GapAnswer" s ON a.id='legacy-'||s.id JOIN "Gap" g ON g.id=s."gapId" JOIN "Topic" t ON t.id=g."topicId" WHERE a."userId"<>s."userId" OR a."createdAt"<>s."createdAt" OR a."topicVersion"<>t.version OR a.practice OR a."isCorrect"<>s."isCorrect"`,
        )
      ).rows[0].count,
    ),
    0,
  );
  const rows = (
    await db.query(
      `SELECT * FROM "GapAttempt" WHERE "userId"=$1 ORDER BY "gapId"`,
      [user],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.chosenValues),
    [["answer"], ["typed answer"]],
  );
  assert.equal(rows[1].chosenText, "typed answer");
  console.log(
    JSON.stringify({
      before,
      after,
      authenticatedAnswers: expected,
      migratedAttempts: expected,
      guestAttempts: 0,
      rollback: true,
    }),
  );
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
