import { deflateRawSync } from "node:zlib";
export const sourceText = Array.from(
  { length: 20 },
  (_, i) =>
    `Chapter ${i + 1}: reading educational material requires attention and careful comparison of examples. Students compare a source with the proposed answer before accepting any explanation.`,
).join("\n\n");
// Minimal real PDF: five text pages, embedded standard font; no medical claims.
export function sourcePdf(scan = false) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pages: number[] = [];
  for (let i = 0; i < 5; i++) {
    const page = objects.length + 1,
      stream = page + 1;
    pages.push(page);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R >>`,
    );
    const data = scan
      ? ""
      : `BT /F1 11 Tf 40 740 Td 15 TL ${Array.from({ length: 6 }, (_, n) => `(${i + 1}.${n + 1} Students carefully compare educational examples with the source.) Tj T*`).join(" ")} ET`;
    objects.push(
      `<< /Length ${Buffer.byteLength(data)} >>\nstream\n${data}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Count 5 /Kids [${pages.map((id) => `${id} 0 R`).join(" ")}] >>`;
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((value, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${value}\nendobj\n`;
  });
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(body);
}
function crc(body: Buffer) {
  let n = 0xffffffff;
  for (const byte of body) {
    n ^= byte;
    for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
export function sourceDocx() {
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${sourceText
      .split("\n\n")
      .map((s) => `<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  };
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [filename, text] of Object.entries(files)) {
    const name = Buffer.from(filename),
      raw = Buffer.from(text),
      data = deflateRawSync(raw),
      header = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc(raw), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc(raw), 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22),
    dir = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(3, 8);
  end.writeUInt16LE(3, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}
