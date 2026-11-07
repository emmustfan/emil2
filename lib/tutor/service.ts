import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db";
import { getEnv } from "../env";
import { lock } from "../auth/session";
import { consumeLimit } from "../access";
import { ContentError } from "../content/errors";
import type { Actor } from "../lessons/types";
import { actorKey } from "../lessons/actor";
import { createLLMProvider } from "../llm";
import type { ChatMessage, LLMProvider } from "../llm/provider";
import { quotaState, recoverExpired, refund, getTutorQuota } from "./quota";
import { containsPersonalData } from "./privacy";
import { resolveScope, citationsAvailable } from "./scope";
import { tutorSettings, type TutorSettings } from "./settings";
import { buildMessages, cleanCitations, MISSING_ANSWER } from "./prompts";
import { retrieve } from "./retrieval";
import type { TutorInput, TutorReply, Citation, Quota, Source } from "./types";
const citationSchema = z.array(
  z.object({
    n: z.number().int().positive(),
    topicId: z.string(),
    topicVersion: z.number().int().positive(),
    blockKey: z.string(),
    heading: z.string().nullable(),
    topicTitle: z.string(),
    href: z.string().startsWith("/learn/"),
  }),
);
export function readCitations(value: unknown): Citation[] | null {
  const result = citationSchema.safeParse(value);
  return result.success ? result.data : null;
}
export class TutorLimitError extends ContentError {
  constructor(public readonly quota: Quota) {
    super("Лимит вопросов исчерпан.", 429, [], "tutor_limit");
  }
}
export type PreparedTurn = {
  actor: Actor;
  scope: { subjectId: string; topicId: string | null; question: string };
  settings: TutorSettings;
  conversationId: string;
  quota: Quota;
  messageId: string;
  runToken: string;
  replay?: TutorReply;
};
export async function prepareTurn(
  input: TutorInput,
  actor: Actor,
  now = new Date(),
): Promise<PreparedTurn> {
  const settings = await tutorSettings();
  if (
    input.kind === "question" &&
    input.text.length > settings.maxQuestionChars
  )
    throw new ContentError(
      `Вопрос — не больше ${settings.maxQuestionChars} символов.`,
    );
  if (input.kind === "question" && containsPersonalData(input.text))
    throw new ContentError(
      "Уберите персональные данные из вопроса.",
      422,
      [],
      "personal_data",
    );
  const { requestId, conversationId, ...payload } = input;
  const inputHash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex"),
    requestKey = `${actorKey(actor)}:${requestId}`;
  return getDb().$transaction(async (tx) => {
    await lock(tx, `usage:tutor:${actorKey(actor)}`);
    await recoverExpired(tx, actor, now);
    const state = await quotaState(tx, actor, settings, now),
      scope = await resolveScope(input, actor, tx);
    if (containsPersonalData(scope.question))
      throw new ContentError(
        "Уберите персональные данные из ответа перед обращением к тьютору.",
        422,
        [],
        "personal_data",
      );
    const previous = await tx.tutorMessage.findUnique({
      where: { requestKey },
      include: { conversation: true },
    });
    if (previous && previous.inputHash !== inputHash)
      throw new ContentError(
        "Идентификатор запроса уже использован для другого вопроса.",
        409,
      );
    if (
      previous &&
      (previous.conversation.subjectId !== scope.subjectId ||
        previous.conversation.topicId !== scope.topicId ||
        (conversationId && previous.conversationId !== conversationId))
    )
      throw new ContentError("Запрос относится к другому диалогу.", 409);
    if (previous?.status === "RUNNING")
      throw new ContentError("Ответ ещё готовится. Подождите немного.", 409);
    if (previous?.status === "COMPLETED") {
      const answer = await tx.tutorMessage.findUnique({
          where: { replyToId: previous.id },
        }),
        citations = answer ? readCitations(answer.citations) : null;
      if (
        !answer ||
        !citations ||
        !(await citationsAvailable(citations, actor, tx))
      )
        throw new ContentError(
          "Источники ответа обновились или больше не доступны. Задайте новый вопрос.",
          409,
        );
      return {
        actor,
        scope,
        settings,
        conversationId: previous.conversationId,
        quota: state.quota,
        messageId: previous.id,
        runToken: "",
        replay: {
          id: answer.id,
          content: answer.content,
          citations,
          feedback: answer.feedback,
        },
      };
    }
    let conversation =
      previous?.conversation ??
      (conversationId
        ? await tx.tutorConversation.findFirst({
            where: { id: conversationId, ...actor },
          })
        : null);
    if (conversationId && !conversation)
      throw new ContentError("Диалог не найден.", 404);
    if (
      conversation &&
      (conversation.subjectId !== scope.subjectId ||
        conversation.topicId !== scope.topicId)
    )
      throw new ContentError("Для другой темы начните новый диалог.", 409);
    if (
      conversation &&
      (await tx.tutorMessage.count({
        where: { conversationId: conversation.id, status: "RUNNING" },
      }))
    )
      throw new ContentError("Дождитесь ответа в этом диалоге.", 409);
    if (state.quota.remaining < 1) throw new TutorLimitError(state.quota);
    await consumeLimit(actorKey(actor), {
      feature: "tutor-rate",
      max: settings.requestsPerMinute,
      periodStart: new Date(Math.floor(now.getTime() / 60000) * 60000),
      db: tx,
    });
    const count = await consumeLimit(actorKey(actor), {
      feature: "tutor",
      max: state.quota.limit,
      periodStart: state.periodStart,
      db: tx,
    });
    conversation ??= await tx.tutorConversation.create({
      data: { ...actor, subjectId: scope.subjectId, topicId: scope.topicId },
    });
    const runToken = randomUUID(),
      data = {
        status: "RUNNING",
        runToken,
        leaseUntil: new Date(
          now.getTime() + settings.timeoutMs + settings.leaseGraceMs,
        ),
        quotaPeriodStart: state.periodStart,
      };
    const message = previous
      ? await tx.tutorMessage.update({ where: { id: previous.id }, data })
      : await tx.tutorMessage.create({
          data: {
            ...data,
            conversationId: conversation.id,
            role: "USER",
            content: scope.question,
            requestKey,
            inputHash,
          },
        });
    return {
      actor,
      scope,
      settings,
      conversationId: conversation.id,
      quota: {
        ...state.quota,
        remaining: Math.max(0, state.quota.limit - count),
      },
      messageId: message.id,
      runToken,
    };
  });
}
function aborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
async function historyFor(turn: PreparedTurn): Promise<ChatMessage[]> {
  const rows = await getDb().tutorMessage.findMany({
    where: {
      conversationId: turn.conversationId,
      status: "COMPLETED",
      role: "ASSISTANT",
      replyToId: { not: null },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.floor(turn.settings.historyMessages / 2),
  });
  const history: ChatMessage[] = [];
  for (const row of rows.reverse()) {
    const citations = readCitations(row.citations);
    if (!citations || !(await citationsAvailable(citations, turn.actor)))
      continue;
    const question = await getDb().tutorMessage.findUnique({
      where: { id: row.replyToId! },
      select: { content: true, status: true },
    });
    if (
      question?.status !== "COMPLETED" ||
      containsPersonalData(question.content) ||
      containsPersonalData(row.content)
    )
      continue;
    history.push(
      { role: "user", content: question.content },
      { role: "assistant", content: cleanCitations(row.content, []) },
    );
  }
  return history;
}
export async function failTurn(turn: PreparedTurn) {
  if (turn.replay) return;
  await getDb().$transaction(async (tx) => {
    await lock(tx, `usage:tutor:${actorKey(turn.actor)}`);
    await refund(tx, turn.actor, turn.messageId, turn.runToken);
  });
}
export async function executeTurn(
  turn: PreparedTurn,
  onDelta: (text: string) => void,
  externalSignal?: AbortSignal,
  provider: LLMProvider = createLLMProvider(getEnv()),
) {
  if (turn.replay)
    return { message: turn.replay, quota: await getTutorQuota(turn.actor) };
  const started = Date.now(),
    signal = externalSignal
      ? AbortSignal.any([
          externalSignal,
          AbortSignal.timeout(turn.settings.timeoutMs),
        ])
      : AbortSignal.timeout(turn.settings.timeoutMs);
  try {
    const sources = await aborted(
      retrieve(
        turn.scope.question,
        turn.scope,
        turn.actor,
        provider,
        turn.settings,
        signal,
      ),
      signal,
    );
    const history = await aborted(historyFor(turn), signal);
    let text = "",
      usage: { tokensIn: number; tokensOut: number } | null = null;
    if (!sources.length) {
      text = MISSING_ANSWER;
      onDelta(text);
    } else {
      const opts = {
        model: getEnv().LLM_CHAT_MODEL || "mock-grounded-v1",
        temperature: getEnv().LLM_TEMPERATURE,
        maxTokens: turn.settings.maxTokens,
        signal,
        onUsage: (value: { tokensIn: number; tokensOut: number }) => {
          usage = value;
        },
      };
      const iterator = provider
        .chat(buildMessages(turn.scope.question, sources, history), opts)
        [Symbol.asyncIterator]();
      try {
        while (true) {
          const next = await aborted(iterator.next(), signal);
          if (next.done) break;
          text += next.value;
          if (text.length > turn.settings.maxAnswerChars)
            throw new Error("Answer too long");
          if (containsPersonalData(text))
            throw new ContentError(
              "Тьютор не может показать ответ с персональными данными. Попробуйте переформулировать вопрос.",
              422,
            );
          onDelta(next.value);
        }
      } finally {
        void iterator.return?.().catch(() => {});
      }
    }
    signal.throwIfAborted();
    text = cleanCitations(
      text,
      sources.map((s) => s.n),
    ).trim();
    if (!text) throw new Error("Empty answer");
    // Retain every supplied source, including one the model forgot to cite.
    // Replay and history must still check its access after a subscription expires.
    const citations = publicSources(sources);
    const tokens = usage as { tokensIn: number; tokensOut: number } | null;
    const message = await getDb().$transaction(async (tx) => {
      await lock(tx, `usage:tutor:${actorKey(turn.actor)}`);
      const pending = await tx.tutorMessage.findFirst({
        where: {
          id: turn.messageId,
          status: "RUNNING",
          runToken: turn.runToken,
        },
      });
      if (!pending || !pending.leaseUntil || pending.leaseUntil <= new Date())
        throw new ContentError(
          "Время ожидания истекло. Повторите вопрос.",
          409,
        );
      await quotaState(tx, turn.actor, turn.settings);
      // Validate the scope even for a response without citations.
      await resolveScope(
        {
          kind: "question",
          text: turn.scope.question,
          subjectId: turn.scope.subjectId,
          ...(turn.scope.topicId ? { topicId: turn.scope.topicId } : {}),
          requestId: randomUUID(),
        },
        turn.actor,
        tx,
      );
      if (!(await citationsAvailable(sources, turn.actor, tx)))
        throw new ContentError(
          "Материал обновился. Задайте вопрос ещё раз.",
          409,
        );
      signal.throwIfAborted();
      const saved = await tx.tutorMessage.create({
        data: {
          conversationId: turn.conversationId,
          replyToId: turn.messageId,
          role: "ASSISTANT",
          content: text,
          citations,
          model: sources.length
            ? getEnv().LLM_CHAT_MODEL || "mock-grounded-v1"
            : "platform-fallback",
          tokensIn: sources.length ? (tokens?.tokensIn ?? null) : 0,
          tokensOut: sources.length ? (tokens?.tokensOut ?? null) : 0,
          latencyMs: Date.now() - started,
        },
      });
      signal.throwIfAborted();
      await tx.tutorMessage.update({
        where: { id: turn.messageId },
        data: { status: "COMPLETED", runToken: null, leaseUntil: null },
      });
      return {
        id: saved.id,
        content: text,
        citations,
        feedback: saved.feedback,
      };
    });
    return { message, quota: await getTutorQuota(turn.actor) };
  } catch (error) {
    await failTurn(turn);
    throw error;
  }
}
export async function setFeedback(actor: Actor, id: string, value: 1 | -1) {
  const result = await getDb().tutorMessage.updateMany({
    where: {
      id,
      role: "ASSISTANT",
      status: "COMPLETED",
      conversation: { ...actor },
    },
    data: { feedback: value },
  });
  if (!result.count) throw new ContentError("Ответ не найден.", 404);
  return { feedback: value };
}
export function tutorError(error: unknown) {
  return error instanceof ContentError
    ? error.message
    : "Не удалось получить ответ тьютора. Попробуйте ещё раз.";
}
export function publicSources(sources: Source[]): Citation[] {
  return sources.map(({ text, ...c }) => {
    void text;
    return c;
  });
}
