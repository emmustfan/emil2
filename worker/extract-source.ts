import { extractSource } from "../lib/imports/extract";
import type { SourceFormat } from "../lib/imports/policy";
process.once(
  "message",
  async (input: { body: string; format: SourceFormat; maxChars: number }) => {
    try {
      const text = await extractSource(
        Buffer.from(input.body, "base64"),
        input.format,
        input.maxChars,
      );
      process.send?.({ text });
    } catch {
      process.send?.({ error: true });
    } finally {
      process.disconnect?.();
    }
  },
);
