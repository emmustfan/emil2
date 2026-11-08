import { z } from "zod";
import type { AppEnv } from "../env";
import type { LLMProvider, ChatMessage, ChatOptions } from "./provider";
import { sseData } from "./sse";
function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Malformed LLM response");
  }
}
const usage = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
});
const openaiEvent = z.object({
  choices: z
    .array(z.object({ delta: z.object({ content: z.string().nullish() }) }))
    .optional(),
  usage: usage.nullish(),
  error: z.unknown().optional(),
});
const anthropicEvent = z.object({
  type: z.string(),
  message: z
    .object({
      usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
    })
    .optional(),
  usage: z.object({ output_tokens: z.number() }).optional(),
  delta: z.object({ text: z.string().optional() }).optional(),
});
export function validateEmbeddings(
  vectors: number[][],
  count: number,
  dimension: number,
) {
  if (
    vectors.length !== count ||
    vectors.some(
      (v) =>
        v.length !== dimension ||
        v.some((n) => !Number.isFinite(n)) ||
        !v.some((n) => n !== 0),
    )
  )
    throw new Error("Invalid embedding dimensions or values");
  return vectors;
}
export class HttpLLMProvider implements LLMProvider {
  constructor(private readonly env: AppEnv) {}
  private async post(
    base: string,
    key: string,
    path: string,
    data: unknown,
    signal?: AbortSignal,
    anthropic = false,
  ) {
    const url = new URL(base.replace(/\/$/, "") + path);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      (this.env.NODE_ENV === "production" && url.protocol !== "https:")
    )
      throw new Error("Invalid provider URL");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(anthropic
          ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify(data),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`LLM upstream failed (${response.status})`);
    }
    return response;
  }
  async *chat(messages: ChatMessage[], opts: ChatOptions) {
    const anthropic = this.env.LLM_PROVIDER === "anthropic";
    const base = this.env.LLM_BASE_URL || "https://api.anthropic.com/v1";
    const common = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1200,
      temperature: opts.temperature ?? this.env.LLM_TEMPERATURE,
      stream: true,
    };
    const response = await this.post(
      base,
      this.env.LLM_API_KEY!,
      anthropic ? "/messages" : "/chat/completions",
      anthropic
        ? {
            ...common,
            system: messages
              .filter((m) => m.role === "system")
              .map((m) => m.content)
              .join("\n\n"),
            messages: messages.filter((m) => m.role !== "system"),
          }
        : { ...common, messages, stream_options: { include_usage: true } },
      opts.signal,
      anthropic,
    );
    let tokensIn = 0,
      tokensOut = 0,
      seenUsage = false,
      finished = false;
    for await (const data of sseData(response.body!, opts.signal)) {
      if (data === "[DONE]") {
        finished = true;
        break;
      }
      if (anthropic) {
        const e = anthropicEvent.parse(parseJSON(data));
        if (e.type === "error") throw new Error("LLM stream failed");
        if (e.message?.usage) {
          tokensIn = e.message.usage.input_tokens;
          tokensOut = e.message.usage.output_tokens;
          seenUsage = true;
        }
        if (e.usage) {
          tokensOut = e.usage.output_tokens;
          seenUsage = true;
        }
        if (e.delta?.text) yield e.delta.text;
        if (e.type === "message_stop") finished = true;
      } else {
        const e = openaiEvent.parse(parseJSON(data));
        if (e.error) throw new Error("LLM stream failed");
        if (e.usage) {
          tokensIn = e.usage.prompt_tokens;
          tokensOut = e.usage.completion_tokens;
          seenUsage = true;
        }
        for (const choice of e.choices ?? [])
          if (choice.delta.content) yield choice.delta.content;
      }
    }
    if (!finished) throw new Error("LLM stream interrupted");
    if (seenUsage) opts.onUsage?.({ tokensIn, tokensOut });
  }
  async complete(messages: ChatMessage[], opts: ChatOptions) {
    let text = "",
      tokensIn = 0,
      tokensOut = 0;
    for await (const part of this.chat(messages, {
      ...opts,
      onUsage: (usage) => {
        tokensIn = usage.tokensIn;
        tokensOut = usage.tokensOut;
        opts.onUsage?.(usage);
      },
    })) {
      if (text.length + part.length > (opts.maxResponseChars ?? 2000000))
        throw new Error("LLM response too large");
      text += part;
    }
    return { text, tokensIn, tokensOut };
  }
  async embed(texts: string[], opts?: { signal?: AbortSignal }) {
    const response = await this.post(
      this.env.LLM_EMBEDDING_BASE_URL || this.env.LLM_BASE_URL!,
      this.env.LLM_EMBEDDING_API_KEY || this.env.LLM_API_KEY!,
      "/embeddings",
      {
        model: this.env.LLM_EMBEDDING_MODEL,
        input: texts,
        dimensions: this.env.EMBEDDING_DIM,
      },
      opts?.signal,
    );
    const text = await response.text();
    if (text.length > 8_000_000)
      throw new Error("Embedding response too large");
    const result = z
      .object({
        data: z.array(
          z.object({
            index: z.number().int().nonnegative(),
            embedding: z.array(z.number()),
          }),
        ),
      })
      .parse(parseJSON(text));
    const data = result.data.sort((a, b) => a.index - b.index);
    if (data.some((d, i) => d.index !== i))
      throw new Error("Invalid embedding indexes");
    return validateEmbeddings(
      data.map((d) => d.embedding),
      texts.length,
      this.env.EMBEDDING_DIM,
    );
  }
}
