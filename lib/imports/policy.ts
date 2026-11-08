import { z } from "zod";
import { ContentError } from "../content/errors";
import { getDb } from "../db";
import { decodeSetting, type SettingKey } from "../settings/defaults";
import { getSetting } from "../settings";
export const importInput = z
  .object({
    subjectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    sectionId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .nullable(),
    rightsConfirmed: z.literal(true),
  })
  .strict();
export type ImportInput = z.infer<typeof importInput>;
export type SourceFormat = "pdf" | "docx" | "text";
export async function importLimits(direct = false) {
  const rows = direct ? await getDb().appSetting.findMany() : [];
  const read = <K extends SettingKey>(key: K) =>
    direct
      ? Promise.resolve(
          decodeSetting(key, rows.find((row) => row.key === key)?.value),
        )
      : getSetting(key);
  const [
    maxBytes,
    maxTextChars,
    partChars,
    maxParts,
    requestsPerHour,
    maxConcurrent,
  ] = await Promise.all([
    read("import.maxBytes"),
    read("import.maxTextChars"),
    read("import.partChars"),
    read("import.maxParts"),
    read("import.requestsPerHour"),
    read("import.maxConcurrent"),
  ]);
  return {
    maxBytes,
    maxTextChars,
    partChars,
    maxParts,
    requestsPerHour,
    maxConcurrent,
  };
}
export function sourceFormat(
  name: string,
  body: Buffer,
  maxBytes: number,
): SourceFormat {
  if (!body.length || body.length > maxBytes)
    throw new ContentError("Файл пуст или превышает допустимый размер.", 413);
  if (/\.pdf$/i.test(name) && body.subarray(0, 5).toString() === "%PDF-")
    return "pdf";
  if (
    /\.docx$/i.test(name) &&
    body.length >= 4 &&
    body.readUInt16LE(0) === 0x4b50
  )
    return "docx";
  if (/\.txt$/i.test(name) && !body.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(body);
      return "text";
    } catch {}
  }
  throw new ContentError(
    "Выберите PDF с текстом, DOCX или текстовый файл UTF-8 (.txt).",
  );
}
