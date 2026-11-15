// Run against a populated PRE-stage-12 copy. All fixtures and DDL roll back.
import "dotenv/config";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  const exists = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Topic' AND column_name='draftTitle'`,
  );
  assert.equal(
    exists.rowCount,
    0,
    "Use a pre-stage-12 database copy, not an already migrated database",
  );
  const prefix = `migration12-${randomUUID()}`;
  const user = `${prefix}-user`,
    subject = `${prefix}-subject`;
  await db.query(
    `INSERT INTO "User" (id,name) VALUES ($1,'Migration fixture')`,
    [user],
  );
  await db.query(
    `INSERT INTO "Subject" (id,slug,title,"shortDescription",courses,"updatedAt") VALUES ($1,$1,'Migration fixture','Synthetic',ARRAY[1],now())`,
    [subject],
  );
  for (const [suffix, status, version] of [
    ["published", "PUBLISHED", 1],
    ["hidden", "DRAFT", 2],
    ["review", "REVIEW", 0],
  ]) {
    const topic = `${prefix}-${suffix}`,
      question = `${topic}-question`,
      gap = `${topic}-gap`,
      run = `${topic}-run`;
    await db.query(
      `INSERT INTO "Topic" (id,"subjectId",slug,title,"contentMd",status,version,"publishedAt","updatedAt") VALUES ($1,$2,$3,$3,'Synthetic [[answer|other]]',$4,$5,CASE WHEN $5>0 THEN now() ELSE null END,now())`,
      [topic, subject, suffix, status, version],
    );
    await db.query(
      `INSERT INTO "Question" (id,"topicId",stem,options,"correctOptionIds",explanation) VALUES ($1,$2,'Synthetic question','[{"id":"a","text":"answer"},{"id":"b","text":"other"}]',ARRAY['a'],'Synthetic explanation')`,
      [question, topic],
    );
    await db.query(
      `INSERT INTO "Gap" (id,"topicId","gapKey","blockKey","order",answer,distractors,sentence) VALUES ($1,$2,'fixture','block',0,'answer',ARRAY['other'],'Synthetic ____')`,
      [gap, topic],
    );
    await db.query(
      `INSERT INTO "GapAnswer" (id,"gapId","userId",chosen,"isCorrect") VALUES ($1,$2,$3,'answer',true)`,
      [`${gap}-answer`, gap, user],
    );
    await db.query(
      `INSERT INTO "Card" (id,"gapId","userId",source,"subjectId","topicId","dueAt") VALUES ($1,$2,$3,'GAP',$4,$5,now())`,
      [`${gap}-card`, gap, user, subject, topic],
    );
    await db.query(
      `INSERT INTO "TestRun" (id,mode,"subjectId","topicId","userId",total) VALUES ($1,'TOPIC',$2,$3,$4,1)`,
      [run, subject, topic, user],
    );
    await db.query(
      `INSERT INTO "QuestionAttempt" (id,"testRunId","questionId","chosenOptionIds","isCorrect") VALUES ($1,$2,$3,ARRAY['a'],true)`,
      [`${run}-answer`, run, question],
    );
  }
  async function counts() {
    const result = {};
    for (const table of ["GapAnswer", "Card", "QuestionAttempt"])
      result[table] = Number(
        (await db.query(`SELECT count(*) FROM "${table}"`)).rows[0].count,
      );
    return result;
  }
  const before = await counts();
  await db.query(
    await readFile(
      new URL(
        "../../prisma/migrations/20261115010000_topic_drafts/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const after = await counts();
  assert.deepEqual(after, before);
  const topics = (
    await db.query(`SELECT * FROM "Topic" WHERE "subjectId"=$1 ORDER BY slug`, [
      subject,
    ])
  ).rows;
  assert.deepEqual(
    topics.map((t) => [t.slug, t.status, t.draftState]),
    [
      ["hidden", "DRAFT", "DRAFT"],
      ["published", "PUBLISHED", "CLEAN"],
      ["review", "DRAFT", "REVIEW"],
    ],
  );
  for (const t of topics) {
    assert.equal(t.draftTitle, t.title);
    assert.equal(t.draftContentMd, t.contentMd);
    assert.deepEqual(t.draftGapExercises, t.gapExercises);
    const q = (
      await db.query(
        `SELECT "publishedAt" FROM "Question" WHERE "topicId"=$1`,
        [t.id],
      )
    ).rows[0];
    assert.equal(Boolean(q.publishedAt), t.version > 0);
    const revisions = (
      await db.query(`SELECT * FROM "TopicRevision" WHERE "topicId"=$1`, [t.id])
    ).rows;
    assert.equal(revisions.length, t.version > 0 ? 1 : 0);
    if (revisions.length) {
      assert.equal(revisions[0].version, t.version);
      assert.equal(revisions[0].contentMd, t.contentMd);
      assert.equal(revisions[0].questions[0].stem, "Synthetic question");
    }
  }
  assert.equal(
    Number(
      (
        await db.query(
          `SELECT count(*) FROM "Topic" WHERE "draftTitle"<>title OR "draftContentMd"<>"contentMd"`,
        )
      ).rows[0].count,
    ),
    0,
  );
  console.log(
    JSON.stringify({ before, after, fixtures: topics.length, rollback: true }),
  );
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
