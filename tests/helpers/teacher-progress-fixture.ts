import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { currentLegal } from "../../lib/auth/legal";
import { newToken, hashToken } from "../../lib/auth/crypto";
import { createLessonFixture, cleanupLessonFixture } from "./lesson-fixture";
import { makeVideo } from "./video-fixture";

export async function createTeacherProgressFixture() {
  const db = getDb();
  const key = randomUUID();
  const legal = await currentLegal();
  const now = new Date();
  const [x, y] = await Promise.all([
    createLessonFixture("journal-x"),
    createLessonFixture("journal-y"),
  ]);
  const faculties = await Promise.all(
    ["a", "b"].map((letter) =>
      db.faculty.create({
        data: {
          slug: `journal-${letter}-${key}`,
          title: `Факультет ${letter}`,
        },
      }),
    ),
  );
  const [departmentX, departmentY] = await Promise.all(
    faculties.map((faculty) =>
      db.department.create({
        data: {
          facultyId: faculty.id,
          slug: "journal",
          title: "Кафедра журнала",
        },
      }),
    ),
  );
  await Promise.all([
    db.subject.update({
      where: { id: x.subject.id },
      data: { departmentId: departmentX.id, title: "Предмет X для журнала" },
    }),
    db.subject.update({
      where: { id: y.subject.id },
      data: { departmentId: departmentY.id, title: "Предмет Y вне журнала" },
    }),
  ]);
  const [a, b] = await Promise.all(
    faculties.map((faculty, i) =>
      db.studyGroup.create({
        data: {
          facultyId: faculty.id,
          name: `Группа журнала ${i + 1}`,
          course: 1,
          academicYear: "2026/2027",
        },
      }),
    ),
  );
  async function user(
    label: string,
    role: "ADMIN" | "EDITOR" | "USER",
    name: string,
    lastName?: string,
  ) {
    return db.user.create({
      data: {
        role,
        name,
        lastName,
        firstName: lastName ? "Студент" : null,
        studentNumber: lastName ? "ЗК-016" : null,
        email: `journal-${label}-${key}@example.test`,
        createdAt: new Date(+now - 30 * 86400000),
        emailVerifiedAt: now,
        consentPdAt: now,
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
      },
    });
  }
  const [
    teacher,
    head,
    facultyAdmin,
    student,
    outsider,
    retired,
    pending,
    admin,
  ] = await Promise.all([
    user("teacher", "EDITOR", "Учитель журнала"),
    user("head", "EDITOR", "Заведующий кафедрой"),
    user("faculty-admin", "EDITOR", "Администратор факультета"),
    user("student", "USER", "ФИО в журнале", "Иванов"),
    user("outside", "USER", "Студент другой группы", "Петров"),
    user("retired", "USER", "PRIVATE_REMOVED", "PRIVATE_LASTNAME"),
    user("pending", "USER", "Ожидает зачисления"),
    user("admin", "ADMIN", "Администратор платформы"),
  ]);
  const users = [
    teacher,
    head,
    facultyAdmin,
    student,
    outsider,
    retired,
    pending,
    admin,
  ];
  const ax = { groupId: a.id, subjectId: x.subject.id };
  const ay = { groupId: a.id, subjectId: y.subject.id };
  const bx = { groupId: b.id, subjectId: x.subject.id };
  const member = { noticeVersion: "fixture", noticeAcceptedAt: now };
  await db.roleAssignment.createMany({
    data: [
      {
        userId: teacher.id,
        role: "REVIEWER",
        subjectId: x.subject.id,
        scopeKey: `subject:${x.subject.id}`,
      },
      {
        userId: head.id,
        role: "DEPARTMENT_HEAD",
        departmentId: departmentX.id,
        scopeKey: `department:${departmentX.id}`,
      },
      {
        userId: facultyAdmin.id,
        role: "FACULTY_ADMIN",
        facultyId: a.facultyId,
        scopeKey: `faculty:${a.facultyId}`,
      },
    ],
  });
  await db.groupSubject.createMany({ data: [ax, ay, bx] });
  await db.groupTeacher.create({ data: { ...ax, teacherId: teacher.id } });
  await db.groupMember.createMany({
    data: [
      { ...member, groupId: a.id, userId: student.id, status: "ACTIVE" },
      { ...member, groupId: b.id, userId: outsider.id, status: "ACTIVE" },
      { ...member, groupId: a.id, userId: retired.id, status: "ACTIVE" },
      { ...member, groupId: a.id, userId: pending.id, status: "PENDING" },
    ],
  });
  const { video, question } = await makeVideo(x, "free");
  const otherVideo = await makeVideo(y, "free");
  // A completed lesson and a wrong first answer followed by correct practice.
  const at = new Date(+now - 25 * 86400000);
  const first = [x.free, x.paid, y.free].flatMap((t) =>
    t.gap_topicId
      .filter((g) => t === x.paid || g.order === 0)
      .map((g) => ({
        userId: student.id,
        gapId: g.id,
        chosen: t === x.free ? g.distractors[0] : g.answer,
        isCorrect: t !== x.free,
        createdAt: at,
      })),
  );
  const initialGap = x.free.gap_topicId.find((g) => g.order === 0)!;
  first.push({
    userId: outsider.id,
    gapId: initialGap.id,
    chosen: initialGap.answer,
    isCorrect: true,
    createdAt: at,
  });
  await db.gapAnswer.createMany({
    data: first.map((a) => ({ ...a, chosenValues: [a.chosen] })),
  });
  await db.gapAttempt.createMany({
    data: [
      ...first.map(({ chosen, ...a }) => ({
        ...a,
        chosenValues: [chosen],
        topicVersion: 1,
        practice: false,
      })),
      {
        userId: student.id,
        gapId: initialGap.id,
        chosenValues: [initialGap.answer],
        isCorrect: true,
        practice: true,
        topicVersion: 1,
        createdAt: new Date(+at + 2000),
      },
    ],
  });
  await db.topicProgress.createMany({
    data: [
      {
        userId: student.id,
        topicId: x.free.id,
        gapsAnswered: 1,
        lastOpenedAt: at,
      },
      {
        userId: student.id,
        topicId: x.paid.id,
        gapsAnswered: 2,
        gapsCorrect: 2,
        testBestScore: 1,
        completedAt: at,
        lastOpenedAt: at,
      },
      {
        userId: student.id,
        topicId: y.free.id,
        gapsAnswered: 1,
        gapsCorrect: 1,
        lastOpenedAt: at,
      },
      {
        userId: outsider.id,
        topicId: x.free.id,
        gapsAnswered: 1,
        gapsCorrect: 1,
        lastOpenedAt: at,
      },
    ],
  });
  await db.testRun.create({
    data: {
      userId: student.id,
      topicId: x.paid.id,
      subjectId: x.subject.id,
      mode: "TOPIC",
      topicVersion: 1,
      total: 5,
      correct: 5,
      score: 1,
      startedAt: at,
      finishedAt: new Date(+at + 60000),
      questionAttempt_testRunId: {
        create: x.paid.question_topicId.map((q) => ({
          questionId: q.id,
          chosenOptionIds: ["b"],
          isCorrect: true,
          createdAt: at,
        })),
      },
    },
  });
  await db.testRun.create({
    data: {
      userId: student.id,
      topicId: x.free.id,
      subjectId: x.subject.id,
      mode: "VIDEO",
      topicVersion: 1,
      total: 1,
      correct: 0,
      score: 0,
      startedAt: at,
      finishedAt: at,
      questionAttempt_testRunId: {
        create: {
          questionId: question.id,
          chosenOptionIds: ["b"],
          isCorrect: false,
          createdAt: at,
        },
      },
    },
  });
  await db.videoProgress.createMany({
    data: [
      {
        userId: student.id,
        videoId: video.id,
        watchedRanges: [[0, 20]],
        watchedSec: 20,
        updatedAt: at,
      },
      {
        userId: student.id,
        videoId: otherVideo.video.id,
        watchedRanges: [],
        selfReported: true,
        updatedAt: at,
        completedAt: at,
      },
    ],
  });
  // The paid exercise is available through enrollment.
  await db.card.create({
    data: {
      userId: student.id,
      source: "QUESTION",
      topicId: x.paid.id,
      subjectId: x.subject.id,
      questionId: x.paid.question_topicId[0].id,
      dueAt: new Date(+now - 3 * 86400000),
    },
  });
  await db.user.update({ where: { id: retired.id }, data: { deletedAt: now } });
  return {
    x,
    y,
    a,
    b,
    ax,
    ay,
    bx,
    video,
    question,
    now,
    teacher,
    head,
    facultyAdmin,
    student,
    outsider,
    retired,
    pending,
    admin,
    async cleanup() {
      await db.studyGroup.deleteMany({ where: { id: { in: [a.id, b.id] } } });
      await cleanupLessonFixture(y);
      await cleanupLessonFixture(
        x,
        [],
        users.map((u) => u.id),
      );
      await db.department.deleteMany({
        where: { id: { in: [departmentX.id, departmentY.id] } },
      });
      await db.faculty.deleteMany({
        where: { id: { in: faculties.map((f) => f.id) } },
      });
    },
  };
}

export async function teacherProgressSession(userId: string) {
  const token = newToken();
  await getDb().session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return token;
}
