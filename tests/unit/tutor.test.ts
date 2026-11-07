import { afterEach, describe, expect, it, vi } from "vitest";
import {
  containsPersonalData,
  redactPersonalData,
} from "../../lib/tutor/privacy";
import { chunkBlocks, publishedBlocks } from "../../lib/tutor/chunks";
import { parseTopic } from "../../lib/content/parse";
import {
  buildMessages,
  cleanCitations,
  SYSTEM_PROMPT,
} from "../../lib/tutor/prompts";
import { tutorInput, type Source } from "../../lib/tutor/types";
import { MockLLMProvider, createLLMProvider } from "../../lib/llm";
import { HttpLLMProvider, validateEmbeddings } from "../../lib/llm/http";
import { sseData } from "../../lib/llm/sse";
import { parseEnv } from "../../lib/env";
import { decodeSetting } from "../../lib/settings/defaults";
const base = { DATABASE_URL: "postgresql://app:app@localhost/app" };
const source: Source = {
  n: 1,
  topicId: "private-topic-id",
  topicVersion: 1,
  blockKey: "private-block-key",
  heading: "Учебный материал",
  topicTitle: "Тема",
  href: "/learn/subject/topic#b-block",
  text: "Первый ответ сохраняется в статистике. Другие попытки нужны для тренировки.",
};
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("tutor input and personal data", () => {
  it.each([
    "телефон +7 (999) 123-45-67",
    "8 999 123 45 67",
    "9991234567",
    "student@example.ru",
    "123-456-789 01",
    "паспорт 12 34 567890",
    "родился 01.02.2000",
    "дата рождения: 1 января 2000",
    "Меня зовут Иван",
  ])("blocks %s", (text) => {
    expect(containsPersonalData(text)).toBe(true);
    expect(redactPersonalData(text)).not.toBe(text);
  });
  it("accepts ordinary educational numbers and does not mistake a topic question for PII", () => {
    expect(
      containsPersonalData(
        "Что означает индекс 2.5 и интервал 10 минут? Почему сохраняется первый ответ?",
      ),
    ).toBe(false);
    expect(
      tutorInput.safeParse({
        kind: "question",
        text: "Материал?",
        topicId: "topic",
        requestId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
    for (const input of [
      { kind: "question", text: "Материал?", requestId: crypto.randomUUID() },
      {
        kind: "question",
        text: "a".repeat(1001),
        topicId: "t",
        requestId: crypto.randomUUID(),
      },
      {
        kind: "question",
        text: "q",
        topicId: "t",
        userId: "forged",
        requestId: crypto.randomUUID(),
      },
    ])
      expect(tutorInput.safeParse(input).success).toBe(false);
  });
  it("caps settings that affect request size, latency and prompt history", () => {
    expect(decodeSetting("tutor.maxQuestionChars", 2000)).toBe(1000);
    expect(decodeSetting("tutor.timeoutMs", 90000)).toBe(60000);
    expect(decodeSetting("tutor.historyMessages", 100)).toBe(6);
    expect(decodeSetting("tutor.topK", 100)).toBe(6);
    expect(decodeSetting("tutor.minSimilarity", 0)).toBe(0);
  });
});
describe("index chunks and prompts", () => {
  it("unfolds the complete configured answer without changing block anchors", () => {
    const md = "## Заголовок\n\nПервый [[один|два]], текст [[=три]].";
    const parsed = parseTopic(md),
      blocks = publishedBlocks(
        md,
        new Map([[parsed.gaps[0].gapKey, "один; два"]]),
      );
    expect(blocks.map((b) => b.blockKey)).toEqual(
      parsed.blocks.map((b) => b.blockKey),
    );
    expect(blocks[1].text).toBe("Первый один; два, текст три.");
    expect(blocks[1].text).not.toContain("[[");
  });
  it("groups within headings, splits long blocks and keeps every chunk below its bound", () => {
    const blocks = publishedBlocks(
      `## Один\n\n${"Учебный фрагмент. ".repeat(1000)}\n\n## Два\n\nКороткий фрагмент.`,
      new Map(),
    );
    const chunks = chunkBlocks(blocks, 300, 800);
    expect(chunks.length).toBeGreaterThan(4);
    expect(
      chunks.every((c) => c.text.length <= 3200 && c.tokenCount <= 800),
    ).toBe(true);
    expect(chunks.find((c) => c.heading === "Два")?.text).not.toContain(
      "Учебный",
    );
    expect(
      chunkBlocks(publishedBlocks("a".repeat(6500), new Map()), 300, 800).every(
        (c) => c.tokenCount <= 800,
      ),
    ).toBe(true);
  });
  it("removes contact data from indexed text and excludes internal identifiers from prompts", () => {
    expect(
      publishedBlocks("Связь: test@example.ru", new Map())[0].text,
    ).not.toContain("test@example.ru");
    const prompt = buildMessages(
      "Почему сохраняется первый ответ?",
      [source],
      [],
    );
    expect(JSON.stringify(prompt)).not.toContain(source.topicId);
    expect(JSON.stringify(prompt)).not.toContain(source.blockKey);
    expect(prompt[0].content).toBe(SYSTEM_PROMPT);
    expect(cleanCitations("Ответ [1], выдуманный [999]", [1])).toBe(
      "Ответ [1], выдуманный ",
    );
  });
  it("produces grounded offline answers and an explicit missing-material fallback", async () => {
    const provider = new MockLLMProvider(1536);
    expect(
      (
        await provider.complete(
          buildMessages("Как сохраняется первый ответ?", [source], []),
          { model: "mock" },
        )
      ).text,
    ).toContain("[1]");
    expect(
      (
        await provider.complete(
          buildMessages("Космический двигатель", [source], []),
          { model: "mock" },
        )
      ).text,
    ).toContain("В материалах платформы этого нет");
    const [a, b, c] = await provider.embed([
      "первый ответ сохраняется",
      "как сохраняется ответ",
      "космический двигатель",
    ]);
    const cosine = (x: number[], y: number[]) =>
      x.reduce((n, v, i) => n + v * y[i], 0);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
    expect(
      (
        await provider.complete(
          buildMessages(
            "Сколько дней в неделе?",
            [{ ...source, text: "Сколько дней в неделе? 7." }],
            [],
          ),
          { model: "mock" },
        )
      ).text,
    ).toContain("7.");
  });
  it("rejects incompatible or non-finite embeddings", () => {
    expect(() => validateEmbeddings([[1]], 1, 1536)).toThrow();
    expect(() => validateEmbeddings([[0, 0]], 1, 2)).toThrow();
    expect(() => validateEmbeddings([[1, NaN]], 1, 2)).toThrow();
  });
});
function stream(parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}
describe("HTTP LLM adapters without external calls", () => {
  it("decodes split CRLF frames and multiline data", async () => {
    const data = [];
    for await (const v of sseData(
      stream(["data: a\r", "\n\r", "\ndata: b\ndata: c\n\n"]),
    ))
      data.push(v);
    expect(data).toEqual(["a", "b\nc"]);
  });
  it("streams OpenAI deltas, usage and embedding indexes through the selected adapter", async () => {
    const env = parseEnv({
      ...base,
      LLM_PROVIDER: "openai_compatible",
      LLM_BASE_URL: "https://llm.example/v1",
      LLM_API_KEY: "fixture",
      LLM_CHAT_MODEL: "chat",
      LLM_EMBEDDING_MODEL: "embedding",
      EMBEDDING_DIM: 2,
    });
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        calls.push(init);
        return calls.length === 1
          ? new Response(
              stream([
                'data: {"choices":[{"delta":{"content":"Ответ [1]"}}]}\n\n',
                'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\ndata: [DONE]\n\n',
              ]),
            )
          : Response.json({
              data: [
                { index: 1, embedding: [0, 1] },
                { index: 0, embedding: [1, 0] },
              ],
            });
      }),
    );
    const provider = createLLMProvider(env),
      usage = vi.fn();
    let text = "";
    for await (const part of provider.chat(
      [{ role: "user", content: "Вопрос" }],
      { model: "chat", onUsage: usage },
    ))
      text += part;
    expect(text).toBe("Ответ [1]");
    expect(usage).toHaveBeenCalledWith({ tokensIn: 12, tokensOut: 4 });
    expect(await provider.embed(["one", "two"])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(JSON.parse(calls[0].body as string).stream).toBe(true);
  });
  it("streams Anthropic text and uses a separate embedding service", async () => {
    const env = parseEnv({
      ...base,
      LLM_PROVIDER: "anthropic",
      LLM_API_KEY: "fixture",
      LLM_CHAT_MODEL: "chat",
      LLM_EMBEDDING_MODEL: "embed",
      LLM_EMBEDDING_BASE_URL: "https://embed.example/v1",
      LLM_EMBEDDING_API_KEY: "embedding-fixture",
      EMBEDDING_DIM: 2,
    });
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        urls.push(url.toString());
        return urls.length === 1
          ? new Response(
              stream([
                'data: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":0}}}\n\ndata: {"type":"content_block_delta","delta":{"text":"Ответ"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\ndata: {"type":"message_stop"}\n\n',
              ]),
            )
          : Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
      }),
    );
    const p = new HttpLLMProvider(env);
    expect(
      await p.complete(
        [
          { role: "system", content: "Правила" },
          { role: "user", content: "Вопрос" },
        ],
        { model: "chat" },
      ),
    ).toEqual({ text: "Ответ", tokensIn: 9, tokensOut: 2 });
    await p.embed(["one"]);
    expect(urls).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://embed.example/v1/embeddings",
    ]);
  });
  it("rejects truncated streams and upstream errors without exposing their response body", async () => {
    const env = parseEnv({
        ...base,
        LLM_PROVIDER: "openai_compatible",
        LLM_BASE_URL: "https://llm.example/v1",
        LLM_API_KEY: "secret-fixture",
        LLM_CHAT_MODEL: "chat",
        LLM_EMBEDDING_MODEL: "embedding",
      }),
      p = new HttpLLMProvider(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            stream(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']),
          ),
      ),
    );
    await expect(p.complete([], { model: "chat" })).rejects.toThrow(
      "interrupted",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("private upstream body", { status: 503 })),
    );
    await expect(p.complete([], { model: "chat" })).rejects.toThrow(
      "LLM upstream failed (503)",
    );
  });
});
