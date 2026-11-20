import { groupFields } from "./input";

function csvFields(line: string, delimiter: string) {
  const fields = [];
  let rest = line;
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith('"')) {
      const quoted = /^"((?:[^"]|"")*)"\s*/.exec(rest);
      if (!quoted) return null;
      fields.push(quoted[1].replaceAll('""', '"'));
      rest = rest.slice(quoted[0].length);
      if (rest && !rest.startsWith(delimiter)) return null;
    } else {
      const end = rest.indexOf(delimiter);
      const field = end < 0 ? rest : rest.slice(0, end);
      if (field.includes('"')) return null;
      fields.push(field.trimEnd());
      rest = end < 0 ? "" : rest.slice(end);
    }
    if (!rest) return fields;
    rest = rest.slice(1);
  }
}

export function parseGroupCsv(csv: string) {
  const rows: ReturnType<typeof groupFields.parse>[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = csv.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const start = lines.findIndex((line) => line.trim());
  const header = lines[start] ?? "";
  const delimiter = header.includes(";") ? ";" : ",";
  const columnNames = csvFields(header, delimiter);
  if (columnNames?.join(";") !== "name;course;academicYear") {
    return {
      rows,
      duplicates: 0,
      errors: [
        {
          line: Math.max(1, start + 1),
          message: "Ожидается заголовок name;course;academicYear.",
        },
      ],
    };
  }

  const keys = new Set<string>();
  let duplicates = 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = csvFields(lines[i], delimiter);
    const [name, course, academicYear] = fields ?? [];
    const group = groupFields.safeParse({ name, course, academicYear });
    if (fields?.length !== 3 || !group.success) {
      errors.push({
        line: i + 1,
        message:
          "Укажите название, курс от 1 до 6 и учебный год в формате 2026/2027.",
      });
      continue;
    }
    const key = JSON.stringify([group.data.name, group.data.academicYear]);
    if (keys.has(key)) {
      duplicates++;
      continue;
    }
    keys.add(key);
    rows.push(group.data);
  }
  return { rows, duplicates, errors };
}
