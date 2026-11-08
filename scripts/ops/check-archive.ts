import { open } from "node:fs/promises";
// Flat files only. Validate type, path and lengths before tar gets write access.
const file = await open(process.argv[2], "r");
try {
  const size = (await file.stat()).size,
    header = Buffer.alloc(512);
  let position = 0,
    files = 0;
  while (position + 512 <= size) {
    await file.read(header, 0, 512, position);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, ""),
      prefix = header.subarray(345, 500).toString().replace(/\0.*$/s, "");
    const kind = header[156],
      lengthText = header
        .subarray(124, 136)
        .toString()
        .replace(/\0.*$/s, "")
        .trim();
    const length = parseInt(lengthText || "0", 8);
    if (
      prefix ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 20971520 ||
      !(
        (name === "./" && kind === 53) ||
        (/^\.\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(name) &&
          [0, 48].includes(kind))
      )
    )
      throw new Error("Неподдерживаемый или небезопасный архив файлов.");
    if (++files > 100000) throw new Error("Слишком много файлов в архиве.");
    position += 512 + Math.ceil(length / 512) * 512;
    if (position > size) throw new Error("Обрезанный архив файлов.");
  }
  console.log("Архив файлов проверен.");
} finally {
  await file.close();
}
