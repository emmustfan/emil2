import { afterEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { extractSource, checkDocxZip } from "../../lib/imports/extract";
import {
  validateDraft,
  generateDraft,
  importMessages,
  splitSource,
} from "../../lib/imports/draft";
import { sourceFormat, importInput } from "../../lib/imports/policy";
import { mockImport } from "../../lib/imports/mock";
import { HttpLLMProvider } from "../../lib/llm/http";
import { MockLLMProvider } from "../../lib/llm";
import { createStorageDriver } from "../../lib/storage";
import { parseEnv } from "../../lib/env";
import { sourcePdf, sourceDocx, sourceText } from "../helpers/import-fixture";
import { DEFAULT_SETTINGS, decodeSetting } from "../../lib/settings/defaults";
afterEach(() => vi.restoreAllMocks());
it("extracts real five-page PDF, DOCX and UTF-8 source; rejects a scan", async () => {
  const pdf = await extractSource(sourcePdf(), "pdf", 60000);
  expect(pdf).toContain("1.1 Students");
  expect(pdf).toContain("5.6 Students");
  expect(await extractSource(sourceDocx(), "docx", 60000)).toContain(
    "Chapter 20",
  );
  expect(await extractSource(Buffer.from(sourceText), "text", 60000)).toBe(
    sourceText,
  );
  await expect(extractSource(sourcePdf(true), "pdf", 60000)).rejects.toThrow(
    "Нужен файл с текстом",
  );
  await expect(
    extractSource(Buffer.from(sourceText), "text", 100),
  ).rejects.toThrow("слишком много текста");
});
it("requires rights and actual signatures and rejects executable/unsupported uploads", () => {
  expect(() =>
    importInput.parse({
      subjectId: "one",
      sectionId: null,
      rightsConfirmed: false,
    }),
  ).toThrow();
  expect(sourceFormat("file.pdf", sourcePdf(), 20971520)).toBe("pdf");
  expect(sourceFormat("file.docx", sourceDocx(), 20971520)).toBe("docx");
  expect(() =>
    sourceFormat("fake.pdf", Buffer.from(sourceText), 20971520),
  ).toThrow("Выберите PDF");
  expect(() => sourceFormat("a.docx", Buffer.from("P"), 20971520)).toThrow(
    "Выберите PDF",
  );
  expect(() =>
    sourceFormat("a.txt", Buffer.from([0, 1, 2]), 20971520),
  ).toThrow();
  expect(() => sourceFormat("a.txt", Buffer.from(sourceText), 10)).toThrow(
    "размер",
  );
});
it("rejects inflated ZIP and damaged DOCX before XML parsing", () => {
  const body = sourceDocx(),
    pos = body.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  body.writeUInt32LE(10 * 1024 * 1024, pos + 24);
  expect(() => checkDocxZip(body)).toThrow("Слишком сложный");
  expect(() => checkDocxZip(Buffer.from("PK"))).toThrow();
});
it("creates a structurally valid technical mock with 15 gaps, 10 questions and 3 diagnostics", async () => {
  const draft = validateDraft(mockImport(sourceText));
  expect(draft.questions).toHaveLength(10);
  const provider = new MockLLMProvider(8);
  expect((await generateDraft(provider, sourceText, "mock")).title).toContain(
    "Технический",
  );
  const invalid = structuredClone(draft);
  invalid.questions[0].sourceBlockKey = "missing";
  expect(() => validateDraft(invalid)).toThrow("sourceBlockKey");
  invalid.questions[0].sourceBlockKey = draft.questions[0].sourceBlockKey;
  invalid.questions[0].isDiagnostic = false;
  expect(() => validateDraft(invalid)).toThrow("диагностических");
});
it("repairs invalid JSON only once and fails atomically after the second invalid result", async () => {
  const provider = new MockLLMProvider(8),
    complete = vi.spyOn(provider, "complete");
  complete
    .mockResolvedValueOnce({ text: "bad-json", tokensIn: 1, tokensOut: 1 })
    .mockResolvedValueOnce({
      text: JSON.stringify(mockImport(sourceText)),
      tokensIn: 1,
      tokensOut: 1,
    });
  await expect(
    generateDraft(provider, sourceText, "mock"),
  ).resolves.toHaveProperty("questions");
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1][0].at(-1)?.content).toContain("repair");
  complete
    .mockReset()
    .mockResolvedValue({ text: "{}", tokensIn: 1, tokensOut: 1 });
  await expect(generateDraft(provider, sourceText, "mock")).rejects.toThrow(
    "дважды",
  );
  expect(complete).toHaveBeenCalledTimes(2);
});
it("redacts known personal data and splits long input near headings without losing text", () => {
  const serialized = JSON.stringify(
    importMessages("Материал test@example.ru +7 999 111-22-33"),
  );
  expect(serialized).not.toContain("test@example.ru");
  expect(serialized).not.toContain("999 111");
  const text =
      "Первый раздел. ".repeat(90) +
      "\n\n# Новый раздел\n" +
      "Второй раздел. ".repeat(80),
    parts = splitSource(text, 1500, 5);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  expect(parts.every((p) => p.length <= 1500)).toBe(true);
  expect(() => splitSource(text, 500, 1)).toThrow("Слишком много тем");
});
it("caps editable import resource limits", () => {
  expect(decodeSetting("import.maxBytes", 999999999)).toBe(
    DEFAULT_SETTINGS["import.maxBytes"],
  );
  expect(decodeSetting("import.maxConcurrent", 3)).toBe(2);
  expect(decodeSetting("import.maxParts", 10)).toBe(5);
  expect(decodeSetting("import.partChars", 1)).toBe(12000);
});
it("uses private bounded S3 operations through the same storage contract without real API calls", async () => {
  const send = vi.spyOn(S3Client.prototype, "send"),
    body = Buffer.from("fixture");
  send.mockImplementation(async (command: unknown) =>
    command instanceof GetObjectCommand
      ? { Body: Readable.from([body]), ContentLength: body.length }
      : {},
  );
  const env = parseEnv({
      DATABASE_URL: "postgresql://app:app@localhost/app",
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://storage.example.test",
      S3_REGION: "test",
      S3_BUCKET: "private",
      S3_ACCESS_KEY: "fixture",
      S3_SECRET_KEY: "fixture",
    }),
    storage = createStorageDriver(env);
  await storage.put("opaque-key", body);
  expect(await storage.get("opaque-key")).toEqual(body);
  await storage.remove("opaque-key");
  const commands = send.mock.calls.map((c) => c[0]);
  expect(commands[0]).toBeInstanceOf(PutObjectCommand);
  expect(commands[0].input).toMatchObject({
    Bucket: "private",
    IfNoneMatch: "*",
  });
  expect(commands[0].input).not.toHaveProperty("ACL");
  expect(commands[2]).toBeInstanceOf(DeleteObjectCommand);
  await expect(storage.get("../secret")).rejects.toThrow("Invalid storage key");
  send.mockImplementation(async () => ({
    Body: Readable.from([body]),
    ContentLength: 30000000,
  }));
  await expect(storage.get("opaque-key")).rejects.toThrow("too large");
});

it("stops collecting an oversized import response instead of retaining an unbounded stream", async () => {
  const provider = new HttpLLMProvider(
    parseEnv({ DATABASE_URL: "postgresql://app:app@localhost/app" }),
  );
  vi.spyOn(provider, "chat").mockImplementation(async function* () {
    yield "first";
    yield "second";
  });
  await expect(
    provider.complete([], { model: "fixture", maxResponseChars: 8 }),
  ).rejects.toThrow("response too large");
});
