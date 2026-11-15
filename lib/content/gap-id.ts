// Shared by the server parser and the browser editor; no Node-only imports.
export const GAP_ID_PATTERN = /^(?:[a-z0-9]{6,12}|[a-f0-9]{40})$/;

export function readGapBody(body: string) {
  const header = /^#([a-z0-9]{6,12}|[a-f0-9]{40})[ \t]+/.exec(body);
  if (!header) return { body, id: undefined };
  return {
    body: body.slice(header[0].length),
    id: header[1],
  };
}

export function gapSourceId(source: string) {
  return readGapBody(source.slice(2, -2)).id;
}

export function gapSourceLabel(source: string) {
  return readGapBody(source.slice(2, -2)).body.replace(/^=/, "").split("|")[0];
}

export function randomGapId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function gapSourceWithId(source: string, id: string) {
  if (!GAP_ID_PATTERN.test(id)) throw new Error("Некорректный ID пропуска.");
  return `[[#${id} ${readGapBody(source.slice(2, -2)).body}]]`;
}
