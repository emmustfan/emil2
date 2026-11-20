import { ContentError } from "../content/errors";
import { parseVideoTime } from "../video/rutube";

export type Cue = { fromSec: number; toSec: number; text: string };

function cueTime(value: string) {
  const match = /^((?:\d{2}:)?\d{2}:\d{2})[.,](\d{3})$/.exec(value);
  if (!match) return null;
  const second = parseVideoTime(match[1]);
  return second === null ? null : second + Number(match[2]) / 1000;
}

export function parseSubtitles(body: Buffer, maxChars: number): Cue[] {
  const fail = () =>
    new ContentError(
      "Нужны субтитры VTT или SRT в UTF-8. Проверьте метки времени и размер файла.",
    );
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw fail();
  }
  if (raw.length > maxChars || raw.includes("\0")) throw fail();
  const result: Cue[] = [];
  for (const block of raw
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n[ \t]*\n+/)) {
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(block)) continue;
    const lines = block.split("\n");
    const timing = lines.findIndex((line) => line.includes("-->"));
    const match =
      timing >= 0 && /^\s*(\S+)\s+-->\s+(\S+)(?:\s.*)?$/.exec(lines[timing]);
    const fromSec = match ? cueTime(match[1]) : null;
    const toSec = match ? cueTime(match[2]) : null;
    const text = lines
      .slice(timing + 1)
      .join(" ")
      .replace(/<[^>\n]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      fromSec === null ||
      toSec === null ||
      fromSec >= toSec ||
      toSec > 86400 ||
      !text
    )
      throw fail();
    result.push({ fromSec, toSec, text });
  }
  if (!result.length) throw fail();
  return result.sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec);
}
