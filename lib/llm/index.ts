import { createHash } from "node:crypto";
import type { AppEnv } from "../env";
import { assertDevelopment, ProviderNotImplementedError } from "../providers";
import type { ChatMessage, ChatOptions, LLMProvider } from "./provider";
export class MockLLMProvider implements LLMProvider {
  constructor(private readonly dimension: number) {
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 8192)
      throw new Error("Invalid embedding dimension");
  }
  async *chat(messages: ChatMessage[], opts: ChatOptions) {
    yield (await this.complete(messages, opts)).text;
  }
  async complete(_messages: ChatMessage[], _opts: ChatOptions) {
    void _messages;
    void _opts;
    return {
      text: "Тестовый ответ. Учебные материалы пока не подключены.",
      tokensIn: 0,
      tokensOut: 0,
    };
  }
  async embed(texts: string[]) {
    return texts.map((text) => {
      const hash = createHash("sha256").update(text).digest();
      const vector = Array.from(
        { length: this.dimension },
        (_, i) => hash[i % hash.length] / 127.5 - 1,
      );
      const norm = Math.hypot(...vector) || 1;
      return vector.map((value) => value / norm);
    });
  }
}
export function createLLMProvider(env: AppEnv): LLMProvider {
  if (env.LLM_PROVIDER !== "mock")
    throw new ProviderNotImplementedError(env.LLM_PROVIDER);
  assertDevelopment(env);
  return new MockLLMProvider(env.EMBEDDING_DIM);
}
