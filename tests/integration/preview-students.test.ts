import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { it, expect } from "vitest";
it("seeds twelve consistent preview learners through domain services, preserves manual changes, refuses unsafe targets and meets the 312-student budget", async () => {
  const source = new URL(process.env.DATABASE_URL!),
    database = `dental_preview_${randomBytes(6).toString("hex")}`,
    target = new URL(source);
  target.pathname = "/" + database;
  const admin = new Client({ connectionString: source.toString() });
  await admin.connect();
  let created = false,
    db: Client | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    db = new Client({ connectionString: target.toString() });
    await db.connect();
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: target.toString(),
      NODE_ENV: "test",
      ADMIN_EMAILS: "owner@example.ru",
      LLM_PROVIDER: "mock",
      PAYMENTS_PROVIDER: "mock",
      MAIL_TRANSPORT: "log",
      STORAGE_DRIVER: "local",
    };
    function run(
      cmd: string,
      args: string[],
      override: Partial<NodeJS.ProcessEnv> = {},
    ) {
      return spawnSync(cmd, args, {
        env: { ...env, ...override },
        encoding: "utf8",
        timeout: 180000,
      });
    }
    for (const args of [
      ["pnpm", "db:migrate"],
      ["pnpm", "db:seed"],
    ]) {
      const r = run("corepack", args);
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
    const seed = run(process.execPath, [
      "--import",
      "tsx",
      "scripts/preview/seed.ts",
    ]);
    expect(seed.status, seed.stdout + seed.stderr).toBe(0);
    const users = (
      await db.query(
        `SELECT id,name,email,"consentPdAt" FROM "User" WHERE email LIKE 'demo-student-%@example.ru' ORDER BY email`,
      )
    ).rows;
    expect(users).toHaveLength(12);
    expect(
      users.every(
        (u) => u.name.startsWith("Демо ") && u.name.endsWith("(демо)"),
      ),
    ).toBe(true);
    expect(users.slice(0, 3).every((u) => u.consentPdAt)).toBe(true);
    expect(
      Number(
        (await db.query(`SELECT count(DISTINCT "userId") FROM "GapAttempt"`))
          .rows[0].count,
      ),
    ).toBe(12);
    expect(
      Number(
        (await db.query(`SELECT count(*) FROM "GapAttempt" WHERE practice`))
          .rows[0].count,
      ),
    ).toBeGreaterThan(6);
    expect(
      Number(
        (await db.query(`SELECT count(*) FROM "ReviewLog"`)).rows[0].count,
      ),
    ).toBeGreaterThan(0);
    expect(
      Number(
        (
          await db.query(
            `SELECT count(*) FROM "AccessGrant" WHERE reason='демо'`,
          )
        ).rows[0].count,
      ),
    ).toBeGreaterThan(0);
    expect(
      (
        await db.query(
          `SELECT t.status,t."needsExpertReview" FROM "Topic" t JOIN "Subject" s ON s.id=t."subjectId" WHERE s.slug='progress-dental-demo'`,
        )
      ).rows[0],
    ).toEqual({ status: "PUBLISHED", needsExpertReview: true });
    expect(
      (
        await db.query(
          `SELECT status FROM "Topic" WHERE slug='fdi-visual-demo' AND "subjectId"<>(SELECT id FROM "Subject" WHERE slug='progress-dental-demo')`,
        )
      ).rows[0].status,
    ).toBe("DRAFT");
    expect(
      Number(
        (
          await db.query(
            `SELECT count(*) FROM "TestRun" WHERE "userId"=ANY($1::text[]) AND (score<0.6 OR score>0.8)`,
            [users.slice(2, 6).map((u) => u.id)],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    expect(
      Number(
        (
          await db.query(
            `SELECT count(*) FROM "TestRun" WHERE "userId"=ANY($1::text[]) AND (score<0.9 OR score>1)`,
            [users.slice(0, 2).map((u) => u.id)],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    const group = (
      await db.query(`
      SELECT id, course, "academicYear" FROM "StudyGroup" WHERE name='Демо-группа 101'
    `)
    ).rows[0];
    expect(group).toMatchObject({ course: 1, academicYear: /^\d{4}\/\d{4}$/ });
    const groupMembers = (
      await db.query(
        `
      SELECT m.status, u.email, m."noticeVersion", m."noticeAcceptedAt"
      FROM "GroupMember" m JOIN "User" u ON m."userId"=u.id WHERE m."groupId"=$1 ORDER BY u.email
    `,
        [group.id],
      )
    ).rows;
    expect(
      groupMembers.filter((m) => m.status === "ACTIVE").map((m) => m.email),
    ).toEqual(users.map((u) => u.email));
    expect(
      groupMembers.filter((m) => m.status === "PENDING").map((m) => m.email),
    ).toEqual(["demo-applicant-01@example.ru", "demo-applicant-02@example.ru"]);
    expect(
      groupMembers.every((m) => m.noticeVersion && m.noticeAcceptedAt),
    ).toBe(true);
    expect(
      (
        await db.query(
          `
      SELECT s.slug, u.email FROM "GroupSubject" gs JOIN "Subject" s ON s.id=gs."subjectId"
      JOIN "GroupTeacher" gt ON (gt."groupId",gt."subjectId")=(gs."groupId",gs."subjectId")
      JOIN "User" u ON u.id=gt."teacherId" WHERE gs."groupId"=$1 ORDER BY s.slug
    `,
          [group.id],
        )
      ).rows,
    ).toEqual(
      ["learning-demo", "platform-demo", "progress-dental-demo"].map(
        (slug) => ({ slug, email: "teacher@example.ru" }),
      ),
    );
    const teacherView = run(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
      import { getDb } from "./lib/db.ts";
      import { staffGroup } from "./lib/groups/queries.ts";
      const db = getDb();
      const teacher = await db.user.findUniqueOrThrow({ where: { email: "teacher@example.ru" } });
      const group = await db.studyGroup.findFirstOrThrow({ where: { name: "Демо-группа 101" } });
      const data = await staffGroup(teacher.id, group.id, "");
      console.log(JSON.stringify(data.members.filter((m) => m.status === "PENDING").map((m) => m.user.email)));
      await db.$disconnect();
    `,
    ]);
    expect(teacherView.status, teacherView.stdout + teacherView.stderr).toBe(0);
    expect(JSON.parse(teacherView.stdout.trim())).toEqual([
      "demo-applicant-01@example.ru",
      "demo-applicant-02@example.ru",
    ]);
    const video = (
      await db.query(`
      SELECT v.id, v."externalId", v."accessKey", t."needsExpertReview", t."contentMd", t.title
      FROM "VideoLecture" v JOIN "Topic" t ON t.id=v."topicId"
      JOIN "Subject" s ON s.id=t."subjectId"
      WHERE s.slug='platform-demo' AND t.slug='test-video-lecture'
    `)
    ).rows[0];
    expect(video).toMatchObject({
      externalId: "9230ec3691d02a011f7f32a577eb23d7",
      accessKey: null,
      needsExpertReview: true,
      title: "Тестовая видеолекция",
    });
    expect(video.contentMd).toContain(video.id);
    expect(video.contentMd).not.toContain(video.externalId);
    const questions = (
      await db.query(
        'SELECT stem,"atSec" FROM "Question" WHERE "videoId"=$1 ORDER BY "atSec"',
        [video.id],
      )
    ).rows;
    expect(questions.map((q) => q.atSec)).toEqual([30, 60]);
    expect(
      questions.every((q) => /демо-вопрос, не учебный материал/i.test(q.stem)),
    ).toBe(true);
    await db.query(
      `UPDATE "GroupMember" SET status='REJECTED' WHERE "groupId"=$1 AND "userId"=(SELECT id FROM "User" WHERE email='demo-applicant-01@example.ru')`,
      [group.id],
    );
    await db.query(
      `UPDATE "User" SET name='Ручная правка (демо)',email='manual-demo-email@example.test' WHERE id=$1`,
      [users[0].id],
    );
    const tables = [
      "User",
      "Subject",
      "Topic",
      "Question",
      "Gap",
      "GapAnswer",
      "GapAttempt",
      "TestRun",
      "QuestionAttempt",
      "TopicProgress",
      "Card",
      "ReviewLog",
      "AccessGrant",
      "TutorConversation",
      "TutorMessage",
      "Event",
      "AppSetting",
      "StudyGroup",
      "GroupMember",
      "GroupSubject",
      "GroupTeacher",
      "VideoLecture",
      "VideoProgress",
    ];
    async function snapshot() {
      const result: Record<string, string> = {};
      for (const table of tables)
        result[table] = (
          await db!.query(
            `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${table}" t`,
          )
        ).rows[0].hash;
      return result;
    }
    const before = await snapshot(),
      repeat = run(process.execPath, [
        "--import",
        "tsx",
        "scripts/preview/seed.ts",
      ]);
    expect(repeat.status, repeat.stdout + repeat.stderr).toBe(0);
    expect(await snapshot()).toEqual(before);
    for (const override of [
      { NODE_ENV: "production" as const },
      { DATABASE_URL: source.toString() },
    ]) {
      const denied = run(
        process.execPath,
        ["--import", "tsx", "scripts/preview/students-demo.ts"],
        override,
      );
      const videoDenied = run(
        process.execPath,
        ["--import", "tsx", "scripts/preview/video-demo.ts"],
        override,
      );
      expect(videoDenied.status).not.toBe(0);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain(
        "Demo students require a preview database",
      );
      expect(await snapshot()).toEqual(before);
    }
    const bench = run(process.execPath, [
      "--import",
      "tsx",
      "scripts/ops/check-stage12a-preview.ts",
    ]);
    expect(bench.status, bench.stdout + bench.stderr).toBe(0);
    const report = JSON.parse(bench.stdout.trim().split("\n").at(-1)!);
    expect(report.demoImageBytes).toBeGreaterThan(0);
    expect(report.syntheticStudents).toBe(300);
    expect(report.totalStudents).toBeGreaterThanOrEqual(312);
    expect(report.p95Ms).toBeLessThanOrEqual(700);
    console.log("Progress benchmark:", JSON.stringify(report));
  } finally {
    await db?.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
}, 240000);
