import { extractText as pdfText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import type { SourceFormat } from "./policy";
// Reject ZIP64, excessive entries and inflated DOCX before mammoth allocates XML.
export function checkDocxZip(body: Buffer) {
  let end = -1;
  for (let i = body.length - 22; i >= Math.max(0, body.length - 65557); i--) {
    if (
      body.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + body.readUInt16LE(i + 20) === body.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Повреждённый DOCX.");
  const count = body.readUInt16LE(end + 10),
    size = body.readUInt32LE(end + 12),
    offset = body.readUInt32LE(end + 16);
  if (
    !count ||
    count > 2000 ||
    offset + size !== end ||
    body.readUInt16LE(end + 4) ||
    body.readUInt16LE(end + 6)
  )
    throw new Error("Неподдерживаемый DOCX.");
  let pos = offset,
    inflated = 0,
    document = false;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > end || body.readUInt32LE(pos) !== 0x02014b50)
      throw new Error("Повреждённый DOCX.");
    const packed = body.readUInt32LE(pos + 20),
      unpacked = body.readUInt32LE(pos + 24);
    inflated += unpacked;
    if (
      inflated > 8 * 1024 * 1024 ||
      unpacked > Math.max(1024 * 1024, packed * 200) ||
      body.readUInt16LE(pos + 8) & 1 ||
      ![0, 8].includes(body.readUInt16LE(pos + 10))
    )
      throw new Error("Слишком сложный или защищённый DOCX.");
    const len = body.readUInt16LE(pos + 28);
    if (
      body.subarray(pos + 46, pos + 46 + len).toString() === "word/document.xml"
    )
      document = true;
    pos += 46 + len + body.readUInt16LE(pos + 30) + body.readUInt16LE(pos + 32);
  }
  if (pos !== end || !document)
    throw new Error("Нужен документ Word в формате DOCX.");
}
export async function extractSource(
  body: Buffer,
  format: SourceFormat,
  maxChars: number,
) {
  let text: string;
  if (format === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(body));
    try {
      if (pdf.numPages > 200)
        throw new Error("В файле больше 200 страниц. Разделите его.");
      text = (await pdfText(pdf, { mergePages: false })).text.join("\n\n");
    } finally {
      await pdf.loadingTask.destroy();
    }
  } else if (format === "docx") {
    checkDocxZip(body);
    text = (await mammoth.extractRawText({ buffer: body })).value;
  } else text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  text = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
  if (text.replace(/\s/g, "").length < 80)
    throw new Error(
      "Нужен файл с текстом. Сканы без текстового слоя пока не поддерживаются.",
    );
  if (text.length > maxChars)
    throw new Error(
      "В документе слишком много текста. Разделите его на несколько файлов.",
    );
  return text;
}
