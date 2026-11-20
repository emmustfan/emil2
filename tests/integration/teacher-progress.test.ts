import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTeacherProgressFixture } from "../helpers/teacher-progress-fixture";
import { testVideoExternalId, testVideoKey } from "../helpers/video-fixture";
import { getDb } from "../../lib/db";
import { anonymizeAccount } from "../../lib/auth/deletion";
import { studentOverview } from "../../lib/admin/cabinet";
import { loadLesson } from "../../lib/lessons/service";
import {
  directoryProgress,
  groupJournal,
  journalFilters,
} from "../../lib/progress/journal";
import { groupAnalysis } from "../../lib/progress/analysis";
import { exportJournal } from "../../lib/progress/export";
import { studentProgress } from "../../lib/progress/student";

vi.mock("../../lib/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/settings")>();
  return {
    ...original,
    getSetting: (key: Parameters<typeof original.getSetting>[0]) =>
      original.withSettingsSnapshot(() => original.getSetting(key)),
  };
});

const db = getDb();
const filters = journalFilters({});
let f: Awaited<ReturnType<typeof createTeacherProgressFixture>>;
beforeAll(async () => {
  f = await createTeacherProgressFixture();
});
afterAll(async () => {
  await f?.cleanup();
  await db.$disconnect();
});

it("limits every service to the specific group, subject and roster, with distinct faculty and department permissions", async () => {
  const {
    teacher,
    head,
    facultyAdmin,
    student,
    outsider,
    pending,
    admin,
    ax,
    ay,
    bx,
  } = f;
  const groups = (await directoryProgress(teacher.id)).groups;
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({
    active: 1,
    pending: 1,
    subjects: [{ id: ax.subjectId, rate: 0.5 }],
  });
  expect(
    (await groupJournal(teacher.id, ax, filters)).rows.map((r) => r.id),
  ).toEqual([student.id]);
  expect(
    (await groupJournal(head.id, bx, filters)).rows.map((r) => r.id),
  ).toEqual([outsider.id]);
  expect(
    (await groupJournal(facultyAdmin.id, ay, filters)).rows.map((r) => r.id),
  ).toEqual([student.id]);
  expect((await groupJournal(admin.id, bx, filters)).rows).toHaveLength(1);
  for (const [id, pair] of [
    [teacher.id, ay],
    [teacher.id, bx],
    [head.id, ay],
    [facultyAdmin.id, bx],
    [student.id, ax],
  ] as const) {
    await expect(groupJournal(id, pair, filters)).rejects.toMatchObject({
      status: 404,
    });
    await expect(groupAnalysis(id, pair)).rejects.toMatchObject({
      status: 404,
    });
    await expect(exportJournal(id, pair, filters)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      studentProgress(student.id, { viewerId: id, ...pair }),
    ).rejects.toMatchObject({ status: 404 });
  }
  for (const id of [outsider.id, pending.id])
    await expect(
      studentProgress(id, { viewerId: teacher.id, ...ax }),
    ).rejects.toMatchObject({ status: 404 });
  await expect(
    groupJournal({ id: teacher.id, readOnly: true }, ax, filters),
  ).rejects.toMatchObject({ status: 404 });
});

it("matches the learner's cabinet and preserves practice, private video data and individual audit records", async () => {
  const { teacher, student, ax, x, y, video } = f;
  const overview = (await studentOverview(student.id)).subjects.find(
    (s) => s.id === x.subject.id,
  )!;
  const journal = await groupJournal(teacher.id, ax, filters);
  const row = journal.rows[0];
  expect(row).toMatchObject({
    completed: overview.completed,
    total: overview.total,
    average: overview.average,
    lagging: true,
    overdue: 1,
  });
  expect(row.cells[0]).toMatchObject({
    accuracy: 0,
    videos: [{ method: "По плееру" }],
  });
  expect(journal.totals[1]).toEqual({ average: 1, completion: 1 });
  const card = await studentProgress(student.id, {
    viewerId: teacher.id,
    ...ax,
  });
  expect(card.group?.id).toBe(ax.groupId);
  expect(card.user).toMatchObject({
    name: "Иванов Студент",
    email: null,
    studentNumber: "ЗК-016",
  });
  expect(card.subjects.map((s) => s.id)).toEqual([x.subject.id]);
  expect(card.topics.every((s) => s.subjectId === x.subject.id)).toBe(true);
  expect(card.review.due).toBe(row.due);
  expect(card.review.overdue).toBe(row.overdue);
  const topic = card.topics.find((t) => t.id === x.free.id)!;
  const gap = topic.gaps[0];
  expect(gap.first).toEqual({ correct: false, chosen: ["неверный-один"] });
  expect(gap.attempts).toEqual([
    expect.objectContaining({
      at: expect.any(String),
      practice: false,
      correct: ["верный-один"],
    }),
    expect.objectContaining({
      at: expect.any(String),
      practice: true,
      chosen: ["верный-один"],
    }),
  ]);
  expect(topic.videos[0]).toMatchObject({
    id: video.id,
    coverage: 0.2,
    method: "По плееру",
    answers: [
      expect.objectContaining({
        chosen: ["Неверный вариант видео"],
        correct: ["Верный вариант видео"],
        at: expect.any(String),
      }),
    ],
  });
  const csv = await exportJournal(teacher.id, ax, filters);
  expect(csv).toContain("Иванов Студент");
  for (const result of [JSON.stringify(card), csv, JSON.stringify(journal)]) {
    expect(result).not.toContain(y.subject.id);
    expect(result).not.toContain(testVideoKey);
    expect(result).not.toContain(testVideoExternalId);
  }
  const logs = await db.studentDataAccess.findMany({
    where: { viewerId: teacher.id, ...ax },
    orderBy: { createdAt: "asc" },
  });
  expect(logs.map((log) => [log.studentId, log.view])).toEqual([
    [student.id, "student_card"],
    [student.id, "export"],
  ]);
  const fresh = await loadLesson(x.free.id, { userId: f.pending.id });
  expect(JSON.stringify(fresh)).not.toMatch(
    /correctOptionIds|correctValues|ОБЪЯСНЕНИЕ_ВИДЕО_ПОСЛЕ_ОТВЕТА/,
  );
});

it("analyses first answers in the active roster including unanswered items and controls editor links", async () => {
  const { teacher, head, facultyAdmin, ax, x, question } = f;
  const analysis = await groupAnalysis(teacher.id, ax);
  expect(analysis.canEdit).toBe(false);
  expect((await groupAnalysis(head.id, ax)).canEdit).toBe(true);
  expect((await groupAnalysis(facultyAdmin.id, ax)).canEdit).toBe(false);
  expect(analysis.items[0].accuracy).toBe(0);
  expect(
    analysis.items.find(
      (item) => item.id === x.free.gap_topicId.find((g) => g.order === 0)?.id,
    ),
  ).toMatchObject({
    kind: "gap",
    total: 1,
    accuracy: 0,
    wrong: [{ text: "неверный-один", count: 1 }],
  });
  expect(analysis.items.find((item) => item.id === question.id)).toMatchObject({
    kind: "video",
    total: 1,
    accuracy: 0,
    wrong: [{ text: "Неверный вариант видео", count: 1 }],
  });
  expect(analysis.items.at(-1)).toMatchObject({ total: 0, accuracy: null });
});

it("keeps only a placeholder after anonymization and excludes it by default", async () => {
  const { teacher, retired, ax } = f;
  expect(await anonymizeAccount(retired.id)).toBe(true);
  expect(
    (await groupJournal(teacher.id, ax, filters)).rows.some(
      (r) => r.id === retired.id,
    ),
  ).toBe(false);
  const withRemoved = { ...filters, removed: true };
  const journal = await groupJournal(teacher.id, ax, withRemoved);
  const card = await studentProgress(retired.id, {
    viewerId: teacher.id,
    ...ax,
  });
  const csv = await exportJournal(teacher.id, ax, withRemoved);
  expect(journal.rows.find((r) => r.id === retired.id)).toMatchObject({
    name: "Удалённый пользователь",
    removed: true,
    deleted: true,
  });
  expect(card.user).toMatchObject({
    name: "Удалённый пользователь",
    email: null,
    studentNumber: null,
    deleted: true,
  });
  for (const output of [JSON.stringify(journal), JSON.stringify(card), csv]) {
    expect(output).toContain("Удалённый пользователь");
    expect(output).not.toMatch(
      /PRIVATE_REMOVED|PRIVATE_LASTNAME|journal-retired/,
    );
  }
});
