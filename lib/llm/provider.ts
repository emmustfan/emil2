export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type ChatOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  maxResponseChars?: number;
  signal?: AbortSignal;
  onUsage?: (usage: { tokensIn: number; tokensOut: number }) => void;
};
export interface LLMProvider {
  chat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<string>;
  complete(
    messages: ChatMessage[],
    opts: ChatOptions,
  ): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
  embed(texts: string[], opts?: { signal?: AbortSignal }): Promise<number[][]>;
}
