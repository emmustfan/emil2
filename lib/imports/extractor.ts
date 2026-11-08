import { fork } from "node:child_process";
import { resolve } from "node:path";
import { ContentError } from "../content/errors";
import type { SourceFormat } from "./policy";
// A damaged document must not block the web/queue process or exhaust its heap.
export function extractIsolated(
  body: Buffer,
  format: SourceFormat,
  maxChars: number,
): Promise<string> {
  return new Promise((ok, fail) => {
    const child = fork(resolve("worker/extract-source.ts"), [], {
      execArgv: ["--import", "tsx", "--max-old-space-size=256"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let settled = false;
    const finish = (text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (text && text.length <= maxChars) ok(text);
      else
        fail(
          new ContentError(
            "Нужен файл с текстом. Проверьте, что это PDF с текстовым слоем, обычный DOCX или UTF-8 текст; уберите защиту и разделите слишком большой документ.",
          ),
        );
    };
    const timer = setTimeout(() => finish(), 30000);
    child.once("message", (value: { text?: string }) => finish(value.text));
    child.once("error", () => finish());
    child.once("exit", () => finish());
    child.send({ body: body.toString("base64"), format, maxChars }, (error) => {
      if (error) finish();
    });
  });
}
