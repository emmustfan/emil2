import { createHash } from "node:crypto";
import type { AppEnv } from "../env";
import { assertDevelopment } from "../providers";
import type { ChatMessage, ChatOptions, LLMProvider } from "./provider";
import { HttpLLMProvider } from "./http";
import { terms } from "./tokens";
export class MockLLMProvider implements LLMProvider {
  constructor(private readonly dimension: number) {
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 8192)
      throw new Error("Invalid embedding dimension");
  }
  async *chat(messages: ChatMessage[], opts: ChatOptions) {
    const result = await this.complete(messages, opts);
    for (let i = 0; i < result.text.length; i += 48) {
      opts.signal?.throwIfAborted();
      yield result.text.slice(i, i + 48);
    }
    opts.onUsage?.(result);
  }
  async complete(messages: ChatMessage[], opts: ChatOptions) {
    opts.signal?.throwIfAborted();
    const question =
      messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    let sources: { n: number; text: string }[] = [];
    for (const m of messages.filter((m) => m.role === "system")) {
      try {
        const parsed = JSON.parse(m.content);
        if (Array.isArray(parsed.sources)) sources = parsed.sources;
      } catch {}
    }
    const words = terms(question);
    const matching = sources
      .filter((s) => words.some((w) => terms(s.text).includes(w)))
      .slice(0, 2);
    const clinical =
      /(?:поставь.*диагноз|назначь.*лечени|у меня болит|реальн[а-я]* пациент)/iu.test(
        question,
      );
    const text = clinical
      ? "Я могу помочь разобрать ситуацию как учебную задачу. Для диагноза и лечения реального пациента обратитесь к врачу."
      : matching.length
        ? "По материалам платформы:\n\n" +
          matching
            .map((s) => {
              const excerpts = s.text
                .split(/(?<=[.!])\s+|\n+/u)
                .filter((part) => words.some((w) => terms(part).includes(w)));
              return `${(excerpts.slice(0, 2).join(" ") || s.text).slice(0, 800)} [${s.n}]`;
            })
            .join("\n\n")
        : "В материалах платформы этого нет. Уточните вопрос или сверьтесь с учебником и преподавателем.";
    return {
      text,
      tokensIn: Math.ceil(
        messages.reduce((n, m) => n + m.content.length, 0) / 4,
      ),
      tokensOut: Math.ceil(text.length / 4),
    };
  }
  async embed(texts: string[], opts?: { signal?: AbortSignal }) {
    return texts.map((text) => {
      opts?.signal?.throwIfAborted();
      const vector = Array.from({ length: this.dimension }, () => 0);
      for (const word of terms(text).length ? terms(text) : [text]) {
        const hash = createHash("sha256").update(word).digest();
        vector[hash.readUInt32BE(0) % this.dimension] += hash[4] % 2 ? 1 : -1;
      }
      if (!vector.some((v) => v !== 0)) vector[0] = 1;
      const norm = Math.hypot(...vector) || 1;
      return vector.map((value) => value / norm);
    });
  }
}
export function createLLMProvider(env: AppEnv): LLMProvider {
  if (env.LLM_PROVIDER !== "mock") return new HttpLLMProvider(env);
  assertDevelopment(env);
  return new MockLLMProvider(env.EMBEDDING_DIM);
}
