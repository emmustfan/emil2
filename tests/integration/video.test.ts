import { afterEach, afterAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { parseTopic } from "../../lib/content/parse";
import { publishTopic } from "../../lib/content/service";
import { createImport } from "../../lib/imports/service";
import { processImport } from "../../lib/imports/worker";
import { MockLLMProvider } from "../../lib/llm";
import {
  loadLesson,
  answerGap,
  answerQuestion,
  startTest,
} from "../../lib/lessons/service";
import {
  saveVideoProgress,
  answerVideoQuestion,
} from "../../lib/video/progress";
import { saveVideo } from "../../lib/video/admin";
import { createStorageDriver } from "../../lib/storage";
import { staffGroup } from "../../lib/groups/queries";
import { createOrgFixture, type OrgFixture } from "../helpers/org-fixture";
import {
  makeVideo,
  fixtureSubtitles,
  testVideoExternalId,
  testVideoKey,
} from "../helpers/video-fixture";

const settings = vi.hoisted(() => ({ requireVideo: true }));
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    key === "lesson.requireVideo"
      ? settings.requireVideo
      : DEFAULT_SETTINGS[key],
}));
vi.mock("../../lib/content/jobs", () => ({
  getContentQueue: vi.fn(async () => ({ send: vi.fn(async () => "queued") })),
  enqueuePublication: vi.fn(async () => {}),
  CONTENT_IMPORT_QUEUE: "content-import",
}));

const db = getDb();
let f: OrgFixture;
beforeEach(async () => {
  f = await createOrgFixture();
  settings.requireVideo = true;
});
afterEach(async () => {
  await f.cleanup();
});
afterAll(async () => {
  await db.$disconnect();
});

it("keeps video checkpoints out of the topic test and requires completing the video for the lesson", async () => {
  const { topic, video, question } = await makeVideo(f.own, "free");
  const learner = await f.user("Learner");
  const actor = { userId: learner.id };
  const lesson = await loadLesson(topic.id, actor);
  expect(lesson.videos?.[0].src).toContain(testVideoKey);
  expect(lesson.videos?.[0].questions[0]).toMatchObject({
    id: question.id,
    atSec: 3,
    feedback: null,
  });
  expect(JSON.stringify(lesson)).not.toContain(question.explanation);
  for (const [i, gap] of lesson.gaps.entries()) {
    const option = gap.options.find(
      (o) => o.text === (i === 0 ? "верный-один" : "верный-два"),
    )!;
    await answerGap(gap.id, option.id, topic.version, actor);
  }
  const run = await startTest(topic.id, topic.version, actor);
  expect(run.questions).toHaveLength(5);
  expect(run.questions.map((q) => q.id)).not.toContain(question.id);
  await expect(
    answerQuestion(topic.id, run.runId!, question.id, "a", actor),
  ).rejects.toMatchObject({ status: 422 });
  for (const question of run.questions)
    await answerQuestion(topic.id, run.runId!, question.id, "b", actor);
  expect((await loadLesson(topic.id, actor)).progress).toMatchObject({
    completed: false,
    videosPending: true,
  });
  settings.requireVideo = false;
  expect((await loadLesson(topic.id, actor)).progress?.completed).toBe(true);
  settings.requireVideo = true;
  const wrong = await answerVideoQuestion(actor, video.id, {
    version: topic.version,
    questionId: question.id,
    optionIds: ["b"],
  });
  expect(wrong.feedback).toMatchObject({
    correct: false,
    explanation: question.explanation,
  });
  await answerVideoQuestion(actor, video.id, {
    version: topic.version,
    questionId: question.id,
    optionIds: ["a"],
  });
  expect(
    await db.testRun.count({
      where: { topicId: topic.id, userId: learner.id, mode: "VIDEO" },
    }),
  ).toBe(1);
  expect(
    await db.questionAttempt.count({
      where: { questionId: question.id, isCorrect: false },
    }),
  ).toBe(1);
  expect(
    await db.card.count({
      where: { userId: learner.id, questionId: question.id },
    }),
  ).toBe(1);
  const jump = await saveVideoProgress(actor, video.id, {
    ranges: [[0, 100]],
    position: 100,
  });
  expect(jump.video).toMatchObject({ completed: false, watchedSec: 0 });
  await expect(
    saveVideoProgress({ ...actor, readOnly: true }, video.id, {
      selfReported: true,
    }),
  ).rejects.toMatchObject({ status: 403 });
  const marked = await saveVideoProgress(actor, video.id, {
    selfReported: true,
  });
  expect(marked.video).toMatchObject({ selfReported: true, completed: true });
  expect(marked.progress.completed).toBe(true);
  expect((await loadLesson(topic.id, actor)).progress?.completed).toBe(true);
});

it("rejects missing, foreign, and archived video references with their Markdown line", async () => {
  const { topic, video, marker } = await makeVideo(f.own, "free");
  const foreign = await makeVideo(f.other, "free");
  const edit = async (reference: string) => {
    const row = await db.topic.update({
      where: { id: topic.id },
      data: {
        draftContentMd: `${reference}\n\n${topic.contentMd}`,
        draftState: "DRAFT",
      },
    });
    await expect(
      publishTopic(topic.id, row.editRevision, f.admin.id),
    ).rejects.toMatchObject({
      status: 422,
      issues: [expect.objectContaining({ line: 1, code: "video_reference" })],
    });
  };
  await edit(`::video{#${randomUUID()}}`);
  await edit(foreign.marker);
  await db.videoLecture.update({
    where: { id: video.id },
    data: { archivedAt: new Date() },
  });
  await edit(marker);
});

it("queues a VTT import, verifies source quotes, and writes only to the lesson draft", async () => {
  const { topic, video } = await makeVideo(f.own, "free", 3600);
  const source = fixtureSubtitles(
    `https://rutube.ru/play/embed/${testVideoExternalId}/?p=${testVideoKey} learner@example.test`,
  );
  const { id } = await createImport(
    f.admin.id,
    {
      subjectId: topic.subjectId,
      sectionId: null,
      rightsConfirmed: true,
      videoId: video.id,
    },
    "lecture.vtt",
    Buffer.from(source),
  );
  const provider = new MockLLMProvider(1536);
  const complete = vi.spyOn(provider, "complete");
  const before = await db.topic.findUniqueOrThrow({ where: { id: topic.id } });
  await processImport(id, provider);
  const job = await db.importJob.findUniqueOrThrow({ where: { id } });
  expect(job).toMatchObject({
    status: "done",
    format: "subtitles",
    report: {
      checkpoints: 6,
      testQuestions: 6,
      rejected: { quote: 1 },
    },
  });
  expect(job.sourceDeletedAt).toBeTruthy();
  await expect(
    createStorageDriver(getEnv()).get(job.fileKey),
  ).rejects.toBeTruthy();
  expect(JSON.stringify(complete.mock.calls)).not.toMatch(
    new RegExp(`${testVideoKey}|${testVideoExternalId}|learner@example`),
  );
  const current = await db.topic.findUniqueOrThrow({ where: { id: topic.id } });
  expect(current).toMatchObject({
    contentMd: before.contentMd,
    draftReviewed: false,
    draftState: "DRAFT",
    version: before.version,
  });
  expect(current.draftContentMd).toContain("## Конспект лекции");
  expect(parseTopic(current.draftContentMd).gaps.length).toBeGreaterThanOrEqual(
    10,
  );
  const questions = await db.question.findMany({
    where: { topicId: topic.id, aiGenerated: true },
  });
  expect(
    questions
      .filter((q) => q.videoId)
      .map((q) => q.atSec)
      .sort((a, b) => a! - b!),
  ).toEqual([12, 372, 732, 1092, 1452, 1812]);
  expect(questions.filter((q) => !q.videoId)).toHaveLength(6);
  expect(
    questions.every(
      (q) =>
        q.publishedAt === null && q.sourceQuote && q.sourceVideoId === video.id,
    ),
  ).toBe(true);
  expect(JSON.stringify(questions)).not.toContain("Искусственная цитата");
  expect(
    (await loadLesson(topic.id, { userId: f.admin.id })).test?.questions,
  ).toHaveLength(5);
});

it("shows a self-report only to the assigned teacher of that open group subject", async () => {
  const { video } = await makeVideo(f.own, "free");
  const learner = await f.user("Learner");
  await db.user.update({
    where: { id: f.author.id },
    data: { role: "EDITOR" },
  });
  await db.roleAssignment.create({
    data: {
      userId: f.author.id,
      role: "AUTHOR",
      subjectId: f.own.subject.id,
      scopeKey: "subject:" + f.own.subject.id,
    },
  });
  const group = await db.studyGroup.create({
    data: {
      facultyId: f.faculty.id,
      name: "Видео",
      course: 1,
      academicYear: "2026/2027",
      members: {
        create: {
          userId: learner.id,
          status: "ACTIVE",
          noticeVersion: "0.1",
          noticeAcceptedAt: new Date(),
        },
      },
      subjects: {
        create: {
          subjectId: f.own.subject.id,
          teachers: { create: { teacherId: f.author.id } },
        },
      },
    },
  });
  await saveVideoProgress({ userId: learner.id }, video.id, {
    selfReported: true,
  });
  expect(
    (await staffGroup(f.author.id, group.id, "")).selfReported.get(learner.id),
  ).toEqual([{ id: video.id, title: video.title }]);
  expect((await staffGroup(f.head.id, group.id, "")).selfReported.size).toBe(0);
});

it("stores live link replacements without exposing credentials in the author metadata response", async () => {
  const { video, topic } = await makeVideo(f.own, "free");
  const updated = await saveVideo(f.admin.id, video.id, {
    topicId: topic.id,
    title: video.title,
    consent: true,
    duration: "1:40",
    link: `https://rutube.ru/play/embed/${testVideoExternalId}/?p=new-private-fixture`,
  });
  expect(updated).toEqual({
    id: video.id,
    title: video.title,
    durationSec: 100,
  });
  expect(
    (await loadLesson(topic.id, { userId: f.admin.id })).videos?.[0].src,
  ).toContain("new-private-fixture");
  expect(
    (await db.topic.findUniqueOrThrow({ where: { id: topic.id } })).version,
  ).toBe(topic.version);
});
