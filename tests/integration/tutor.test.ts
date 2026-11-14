import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
import { indexTopic } from "../../lib/tutor/indexing";
import {
  prepareTurn,
  executeTurn,
  failTurn,
  setFeedback,
  type PreparedTurn,
} from "../../lib/tutor/service";
import { getTutorQuota } from "../../lib/tutor/quota";
import {
  answerGap,
  answerQuestion,
  loadLesson,
  startTest,
} from "../../lib/lessons/service";
import { MockLLMProvider } from "../../lib/llm";
import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "../../lib/llm/provider";
import type { Actor } from "../../lib/lessons/types";
import type { TutorInput } from "../../lib/tutor/types";
const config = vi.hoisted(() => ({ timeout: 60000, demo: 5, rate: 10 }));
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    key === "tutor.timeoutMs"
      ? config.timeout
      : key === "tutor.demoLimit"
        ? config.demo
        : key === "tutor.requestsPerMinute"
          ? config.rate
          : DEFAULT_SETTINGS[key],
}));
const db = getDb(),
  provider = new MockLLMProvider(1536);
let f: LessonFixture;
const demos: string[] = [],
  users: string[] = [];
async function guest(): Promise<Actor> {
  const d = await db.demoSession.create({
    data: { anonId: randomUUID(), stepsCompleted: [] },
  });
  demos.push(d.id);
  return { demoSessionId: d.id };
}
async function user(): Promise<Actor> {
  const u = await db.user.create({
    data: {
      email: `tutor-${randomUUID()}@example.test`,
      name: "PRIVATE_PROFILE_NAME",
      timezone: "Asia/Yekaterinburg",
    },
  });
  users.push(u.id);
  return { userId: u.id };
}
async function ask(
  actor: Actor,
  text = "Первый выбор",
  conversationId?: string,
  topicId: string | null = f.free.id,
) {
  const input: TutorInput = {
    kind: "question",
    text,
    ...(topicId ? { topicId } : {}),
    ...(!topicId ? { subjectId: f.subject.id } : {}),
    conversationId,
    requestId: randomUUID(),
  };
  const turn = await prepareTurn(input, actor),
    parts: string[] = [];
  const result = await executeTurn(turn, (t) => parts.push(t));
  return { ...result, turn, input, streamed: parts.join("") };
}
beforeEach(async () => {
  config.timeout = 60000;
  config.demo = 5;
  config.rate = 10;
  f = await createLessonFixture("tutor-test");
  for (const t of [f.free, f.paid])
    await indexTopic({ topicId: t.id, subjectId: f.subject.id, version: 1 });
});
afterEach(async () => {
  await cleanupLessonFixture(f, demos.splice(0), users.splice(0));
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.$disconnect();
});
it("indexes publications atomically, ignores old jobs and excludes stale versions", async () => {
  const initial = await db.contentChunk.count({
    where: { topicId: f.free.id },
  });
  expect(initial).toBeGreaterThan(0);
  await indexTopic({ topicId: f.free.id, subjectId: f.subject.id, version: 1 });
  expect(await db.contentChunk.count({ where: { topicId: f.free.id } })).toBe(
    initial,
  );
  const broken: LLMProvider = {
    ...provider,
    chat: provider.chat.bind(provider),
    complete: provider.complete.bind(provider),
    embed: async () => [[1]],
  };
  await expect(
    indexTopic(
      { topicId: f.free.id, subjectId: f.subject.id, version: 1 },
      broken,
    ),
  ).rejects.toThrow("Invalid embedding");
  expect(await db.contentChunk.count({ where: { topicId: f.free.id } })).toBe(
    initial,
  );
  await db.topic.update({ where: { id: f.free.id }, data: { version: 2 } });
  expect(
    await indexTopic({
      topicId: f.free.id,
      subjectId: f.subject.id,
      version: 1,
    }),
  ).toEqual({ indexed: false });
  const actor = await guest();
  await expect(ask(actor)).rejects.toMatchObject({ status: 503 });
  expect((await getTutorQuota(actor)).remaining).toBe(5);
  await indexTopic({ topicId: f.free.id, subjectId: f.subject.id, version: 2 });
  expect((await ask(actor)).message.citations[0].topicVersion).toBe(2);
});
it("streams grounded answers with valid anchors and records usage, latency, model and owned feedback", async () => {
  const actor = await guest(),
    result = await ask(actor);
  expect(result.streamed).toBe(result.message.content);
  expect(result.message.content).toContain("[1]");
  const cite = result.message.citations[0];
  expect(cite.topicId).toBe(f.free.id);
  expect(cite.href).toContain(`/learn/${f.subject.slug}/free#b-`);
  expect(result.quota).toMatchObject({
    remaining: 4,
    limit: 5,
    tier: "guest",
    resetAt: null,
  });
  expect(
    await db.tutorMessage.findUnique({ where: { id: result.message.id } }),
  ).toMatchObject({
    role: "ASSISTANT",
    status: "COMPLETED",
    model: "mock-grounded-v1",
    tokensIn: expect.any(Number),
    tokensOut: expect.any(Number),
    latencyMs: expect.any(Number),
  });
  expect(await setFeedback(actor, result.message.id, -1)).toEqual({
    feedback: -1,
  });
  await expect(
    setFeedback(await guest(), result.message.id, 1),
  ).rejects.toMatchObject({ status: 404 });
});
it("replays an identical request without consuming quota or creating duplicate messages", async () => {
  const actor = await user(),
    result = await ask(actor);
  const replay = await prepareTurn(result.input, actor);
  expect(replay.replay?.id).toBe(result.message.id);
  expect((await executeTurn(replay, () => {})).quota.remaining).toBe(14);
  expect(
    await db.tutorMessage.count({
      where: { conversationId: result.turn.conversationId },
    }),
  ).toBe(2);
  await expect(
    prepareTurn({ ...result.input, text: "Другой вопрос" }, actor),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    prepareTurn(
      {
        ...result.input,
        requestId: randomUUID(),
        conversationId: result.turn.conversationId,
      },
      await user(),
    ),
  ).rejects.toMatchObject({ status: 404 });
});
it("keeps a guest within the chosen topic and free accounts away from paid text", async () => {
  const actor = await guest();
  const guestResult = await ask(actor, "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ");
  expect(guestResult.message.content).toContain(
    "В материалах платформы этого нет",
  );
  expect(guestResult.message.citations).toEqual([]);
  await expect(
    prepareTurn(
      {
        kind: "question",
        text: "Первый выбор",
        subjectId: f.subject.id,
        requestId: randomUUID(),
      },
      actor,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    prepareTurn(
      {
        kind: "question",
        text: "Первый выбор",
        topicId: f.paid.id,
        requestId: randomUUID(),
      },
      actor,
    ),
  ).rejects.toMatchObject({ status: 403 });
  const free = await ask(
    await user(),
    "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
    undefined,
    null,
  );
  expect(JSON.stringify(free.message)).not.toContain(
    "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
  );
});
it("revokes paid retrieval, replay and history immediately when the grant expires", async () => {
  const actor = await user(),
    grant = await db.accessGrant.create({
      data: {
        userId: actor.userId!,
        grantedById: actor.userId!,
        subjectId: f.subject.id,
        reason: "Синтетическая проверка",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  const first = await ask(
    actor,
    "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
    undefined,
    null,
  );
  expect(first.message.content).toContain("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ");
  expect(first.quota.tier).toBe("paid");
  await db.accessGrant.update({
    where: { id: grant.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(prepareTurn(first.input, actor)).rejects.toMatchObject({
    status: 409,
  });
  const turn = await prepareTurn(
    {
      kind: "question",
      text: "Первый выбор",
      subjectId: f.subject.id,
      conversationId: first.turn.conversationId,
      requestId: randomUUID(),
    },
    actor,
  );
  const seen: ChatMessage[][] = [];
  const spy: LLMProvider = {
    embed: provider.embed.bind(provider),
    complete: provider.complete.bind(provider),
    async *chat(messages, opts) {
      seen.push(messages);
      yield* provider.chat(messages, opts);
    },
  };
  await executeTurn(turn, () => {}, undefined, spy);
  expect(JSON.stringify(seen)).not.toContain(
    "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
  );
});
it("blocks personal data before persistence, quota reservation or provider work", async () => {
  const actor = await guest();
  for (const text of [
    "Позвони +7 (999) 123-45-67",
    "Почта user@example.ru",
    "паспорт 12 34 567890",
  ])
    await expect(
      prepareTurn(
        { kind: "question", text, topicId: f.free.id, requestId: randomUUID() },
        actor,
      ),
    ).rejects.toMatchObject({ status: 422, code: "personal_data" });
  expect(await db.tutorConversation.count({ where: { ...actor } })).toBe(0);
  expect((await getTutorQuota(actor)).remaining).toBe(5);
});
it("allows exactly five guest requests across simultaneous tabs and rejects the sixth", async () => {
  const actor = await guest();
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      prepareTurn(
        {
          kind: "question",
          text: "Первый выбор",
          topicId: f.free.id,
          requestId: randomUUID(),
        },
        actor,
      ),
    ),
  );
  const success = attempts.filter(
    (r): r is PromiseFulfilledResult<PreparedTurn> => r.status === "fulfilled",
  );
  expect(success).toHaveLength(5);
  expect(attempts.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 429, quota: { remaining: 0, tier: "guest" } },
  });
  expect((await getTutorQuota(actor)).remaining).toBe(0);
  for (const item of success) await failTurn(item.value);
  expect((await getTutorQuota(actor)).remaining).toBe(5);
});
it("refunds a timed-out request once and permits retry with the original request ID", async () => {
  config.timeout = 30;
  const actor = await guest(),
    input: TutorInput = {
      kind: "question",
      text: "Первый выбор",
      topicId: f.free.id,
      requestId: randomUUID(),
    },
    turn = await prepareTurn(input, actor);
  const stalled: LLMProvider = {
    chat: provider.chat.bind(provider),
    complete: provider.complete.bind(provider),
    embed: async () => new Promise<number[][]>(() => {}),
  };
  await expect(
    executeTurn(turn, () => {}, undefined, stalled),
  ).rejects.toThrow();
  await failTurn(turn);
  expect((await getTutorQuota(actor)).remaining).toBe(5);
  config.timeout = 60000;
  const retry = await prepareTurn(input, actor);
  const result = await executeTurn(retry, () => {});
  expect(result.quota.remaining).toBe(4);
  expect(
    await db.tutorMessage.count({
      where: { conversationId: turn.conversationId },
    }),
  ).toBe(2);
});
it("recovers a crashed reservation when its lease expires and keeps the per-minute abuse limit", async () => {
  const actor = await guest(),
    turn = await prepareTurn(
      {
        kind: "question",
        text: "Первый выбор",
        topicId: f.free.id,
        requestId: randomUUID(),
      },
      actor,
    );
  await db.tutorMessage.update({
    where: { id: turn.messageId },
    data: { leaseUntil: new Date(0) },
  });
  expect((await getTutorQuota(actor)).remaining).toBe(5);
  await failTurn(turn);
  expect((await getTutorQuota(actor)).remaining).toBe(5);
  config.rate = 1;
  await expect(
    prepareTurn(
      {
        kind: "question",
        text: "Первый выбор",
        topicId: f.free.id,
        requestId: randomUUID(),
      },
      actor,
    ),
  ).rejects.toMatchObject({ status: 429 });
});
it("uses the free Plan daily limit and resets at the local midnight without affecting previous-day counts", async () => {
  const actor = await user(),
    now = new Date("2030-11-07T18:59:00Z"),
    next = new Date("2030-11-07T19:00:00Z");
  const t = await prepareTurn(
    {
      kind: "question",
      text: "Первый выбор",
      topicId: f.free.id,
      requestId: randomUUID(),
    },
    actor,
    now,
  );
  expect(t.quota).toMatchObject({
    remaining: 14,
    limit: 15,
    resetAt: next.toISOString(),
    timeZone: "Asia/Yekaterinburg",
  });
  await db.tutorMessage.update({
    where: { id: t.messageId },
    data: { status: "COMPLETED", leaseUntil: null, runToken: null },
  });
  expect((await getTutorQuota(actor, next)).remaining).toBe(15);
  expect(
    await db.usageCounter.findFirst({
      where: { actorKey: `user:${actor.userId}`, feature: "tutor" },
    }),
  ).toMatchObject({ count: 1, periodStart: new Date("2030-11-06T19:00:00Z") });
});
it("builds error explanations from the owned stored answer and never accepts an unanswered or foreign attempt", async () => {
  const actor = await guest(),
    g = (await loadLesson(f.free.id, actor)).gaps[0];
  const input: TutorInput = {
    kind: "explain",
    source: "GAP",
    sourceId: g.id,
    topicVersion: 1,
    requestId: randomUUID(),
  };
  await expect(prepareTurn(input, actor)).rejects.toMatchObject({
    status: 409,
  });
  await answerGap(
    g.id,
    g.options.find((o) => o.text === "неверный-один")!.id,
    1,
    actor,
  );
  const turn = await prepareTurn(input, actor);
  expect(turn.scope.question).toContain("неверный-один");
  expect(turn.scope.question).toContain("верный-один");
  expect((await executeTurn(turn, () => {})).message.content).toContain("[1]");
  await expect(
    prepareTurn({ ...input, requestId: randomUUID() }, await guest()),
  ).rejects.toMatchObject({ status: 409 });
  const run = await startTest(f.free.id, 1, actor),
    q = run.questions[0];
  await answerQuestion(f.free.id, run.runId!, q.id, "a", actor);
  const qt = await prepareTurn(
    {
      kind: "explain",
      source: "QUESTION",
      sourceId: q.id,
      runId: run.runId!,
      topicVersion: 1,
      requestId: randomUUID(),
    },
    actor,
  );
  expect(qt.scope.question).toContain("Вариант Б");
  await failTurn(qt);
});
it("never forwards profile data or more than six history messages to the provider", async () => {
  const actor = await user();
  let conversationId: string | undefined;
  for (let i = 0; i < 4; i++)
    conversationId = (await ask(actor, "Первый выбор", conversationId)).turn
      .conversationId;
  const input: TutorInput = {
      kind: "question",
      text: "Первый выбор",
      topicId: f.free.id,
      conversationId,
      requestId: randomUUID(),
    },
    turn = await prepareTurn(input, actor);
  let captured: ChatMessage[] = [];
  const spy: LLMProvider = {
    embed: provider.embed.bind(provider),
    complete: provider.complete.bind(provider),
    async *chat(messages: ChatMessage[], opts: ChatOptions) {
      captured = messages;
      yield* provider.chat(messages, opts);
    },
  };
  await executeTurn(turn, () => {}, undefined, spy);
  expect(captured.filter((m) => m.role !== "system")).toHaveLength(7);
  expect(JSON.stringify(captured)).not.toContain("PRIVATE_PROFILE_NAME");
  expect(JSON.stringify(captured)).not.toContain(actor.userId!);
  expect(JSON.stringify(captured)).not.toContain("@example.test");
});
it("hides drafts and archived subjects from retrieval and rejects blocked actors", async () => {
  const actor = await user();
  await db.topic.update({
    where: { id: f.free.id },
    data: { status: "DRAFT" },
  });
  await expect(
    prepareTurn(
      {
        kind: "question",
        text: "Первый выбор",
        topicId: f.free.id,
        requestId: randomUUID(),
      },
      actor,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await ask(actor, "Первый выбор", undefined, null)).message.citations,
  ).toEqual([]);
  await db.user.update({
    where: { id: actor.userId! },
    data: { blockedAt: new Date() },
  });
  await expect(getTutorQuota(actor)).rejects.toMatchObject({ status: 401 });
});
it("retains the access footprint even when a model omits footnotes", async () => {
  const actor = await user(),
    grant = await db.accessGrant.create({
      data: {
        userId: actor.userId!,
        grantedById: actor.userId!,
        subjectId: f.subject.id,
        reason: "Синтетическая проверка",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  const input: TutorInput = {
      kind: "question",
      text: "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
      subjectId: f.subject.id,
      requestId: randomUUID(),
    },
    turn = await prepareTurn(input, actor);
  const uncited: LLMProvider = {
    embed: provider.embed.bind(provider),
    complete: provider.complete.bind(provider),
    async *chat() {
      yield "Ответ из найденного материала без сноски.";
    },
  };
  const result = await executeTurn(turn, () => {}, undefined, uncited);
  expect(result.message.citations.some((c) => c.topicId === f.paid.id)).toBe(
    true,
  );
  await db.accessGrant.update({
    where: { id: grant.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(prepareTurn(input, actor)).rejects.toMatchObject({
    status: 409,
  });
});
it("refunds a disconnect or unsafe model response without storing a partial assistant message", async () => {
  for (const mode of ["disconnect", "personal-data"] as const) {
    const actor = await guest(),
      turn = await prepareTurn(
        {
          kind: "question",
          text: "Первый выбор",
          topicId: f.free.id,
          requestId: randomUUID(),
        },
        actor,
      ),
      abort = new AbortController();
    const custom: LLMProvider = {
      embed: provider.embed.bind(provider),
      complete: provider.complete.bind(provider),
      async *chat() {
        yield "Начало ответа ";
        yield mode === "personal-data" ? "student@example.ru" : "продолжение";
      },
    };
    await expect(
      executeTurn(
        turn,
        () => {
          if (mode === "disconnect") abort.abort();
        },
        abort.signal,
        custom,
      ),
    ).rejects.toThrow();
    expect((await getTutorQuota(actor)).remaining).toBe(5);
    expect(
      await db.tutorMessage.count({
        where: { conversationId: turn.conversationId, role: "ASSISTANT" },
      }),
    ).toBe(0);
  }
});
it("does not publish an index generated while its source changes, or trust old access metadata", async () => {
  const before = await db.contentChunk.count({ where: { topicId: f.free.id } });
  const changing: LLMProvider = {
    chat: provider.chat.bind(provider),
    complete: provider.complete.bind(provider),
    embed: async (texts, opts) => {
      await db.topic.update({ where: { id: f.free.id }, data: { version: 2 } });
      return provider.embed(texts, opts);
    },
  };
  expect(
    await indexTopic(
      { topicId: f.free.id, subjectId: f.subject.id, version: 1 },
      changing,
    ),
  ).toEqual({ indexed: false });
  expect(await db.contentChunk.count({ where: { topicId: f.free.id } })).toBe(
    before,
  );
  await db.contentChunk.updateMany({
    where: { topicId: f.paid.id },
    data: { isFreeTopic: true },
  });
  await indexTopic({ topicId: f.free.id, subjectId: f.subject.id, version: 2 });
  expect(
    (
      await ask(
        await user(),
        "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
        undefined,
        null,
      )
    ).message.citations,
  ).toEqual([]);
  await db.subject.update({
    where: { id: f.subject.id },
    data: { status: "DRAFT" },
  });
  expect(
    await indexTopic({
      topicId: f.paid.id,
      subjectId: f.subject.id,
      version: 1,
    }),
  ).toEqual({ indexed: false });
});
