import { expect, it } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { lessonEditorExtensions } from "../../lib/editor/extensions";
import { parseTopic } from "../../lib/content/parse";
import {
  parseRutube,
  parseVideoTime,
  rutubeEmbed,
} from "../../lib/video/rutube";
import { mergeWatchRanges, videoCompleted } from "../../lib/video/ranges";
import {
  readRutubeEvent,
  rutubeCommand,
  rutubeProtocol,
} from "../../lib/video/rutube-protocol";
import { parseSubtitles } from "../../lib/imports/subtitles";
import { decodeSetting } from "../../lib/settings/defaults";

const id = "9230ec3691d02a011f7f32a577eb23d7";
it("normalizes supported Rutube links and ignores unrelated query parameters", () => {
  for (const url of [
    `https://rutube.ru/video/${id}/?r=wd&t=30`,
    `https://rutube.ru/play/embed/${id}`,
    `<iframe src="https://rutube.ru/play/embed/${id}/?r=wd&amp;t=30" allowfullscreen></iframe>`,
  ])
    expect(parseRutube(url)).toEqual({ externalId: id, accessKey: null });
  for (const url of [
    `https://rutube.ru/video/private/${id}/?r=wd&p=A-b_123&t=30`,
    `https://rutube.ru/play/embed/${id}/?p=A-b_123`,
    `<iframe width='500' src='https://rutube.ru/play/embed/${id}?p=A-b_123&amp;r=wd'></iframe>`,
  ]) {
    const result = parseRutube(url);
    expect(result).toEqual({ externalId: id, accessKey: "A-b_123" });
    expect(rutubeEmbed(result!)).toBe(
      `https://rutube.ru/play/embed/${id}/?p=A-b_123`,
    );
  }
});

it("rejects invalid hosts, IDs, path normalization and injected or duplicated keys", () => {
  for (const url of [
    `https://rutube.ru.attacker.invalid/video/${id}`,
    `https://rutube.ru@attacker.invalid/video/${id}`,
    `http://rutube.ru/video/${id}`,
    `https://rutube.ru:444/video/${id}`,
    `https://rutube.ru/foo/../video/${id}`,
    `https://rutube.ru/video/${id.toUpperCase()}`,
    `https://rutube.ru/video/${id.slice(1)}`,
    `https://rutube.ru/video/private/${id}`,
    `https://rutube.ru/video/private/${id}?p=`,
    `https://rutube.ru/video/private/${id}?p=a&p=b`,
    `https://rutube.ru/video/private/${id}?p=%22%3E`,
    `https://rutube.ru/video/private/${id}?p=a%26fake`,
    `https://rutube.ru/video/private/${id}?p=${"x".repeat(129)}`,
    `<iframe src="https://rutube.ru/play/embed/${id}"></iframe><script></script>`,
  ])
    expect(parseRutube(url), url).toBeNull();
  expect(parseVideoTime("1:02:03")).toBe(3723);
  expect(parseVideoTime("00:60")).toBeNull();
  expect(parseVideoTime("0:00")).toBe(0);
});

it("merges only valid coverage and tests the exact completion boundary", () => {
  const result = mergeWatchRanges(
    [[0, 15]],
    [
      [0, 15],
      [10, 20],
      [20, 40],
      [40, 61],
      [89, 100],
      [-1, 10],
      [90, 106],
    ],
    100,
  );
  expect(result).toEqual({
    ranges: [
      [0, 40],
      [89, 100],
    ],
    watchedSec: 51,
  });
  expect(
    mergeWatchRanges(
      [],
      [
        [100, 100],
        [0, 100],
      ],
      100,
    ).watchedSec,
  ).toBe(0);
  expect(videoCompleted(89, 100, 0.9)).toBe(false);
  expect(videoCompleted(90, 100, 0.9)).toBe(true);
  expect(videoCompleted(100, null, 0.9)).toBe(false);
  expect(decodeSetting("lesson.requireVideo", false)).toBe(false);
});

it("preserves an isolated video block through editor round trip", () => {
  const marker = "::video{#00000000-0000-4000-8000-000000000015}";
  const raw = `## Видео\n\nСлово [[ответ|вариант]].\n\n${marker}\n\nСледующий абзац.`;
  const manager = new MarkdownManager({ extensions: lessonEditorExtensions() });
  const state = manager.parse(raw);
  expect(JSON.stringify(state)).toContain("lessonVideo");
  const result = parseTopic(manager.serialize(state));
  expect(result.errors).toEqual([]);
  expect(result.blocks.filter((block) => block.kind === "video")).toEqual([
    expect.objectContaining({
      videoId: "00000000-0000-4000-8000-000000000015",
      text: "",
      blockKey: expect.any(String),
    }),
  ]);
  expect(parseTopic(`Перед блоком\n${marker}`).errors).toHaveLength(1);
});

it("accepts only recognized player messages and encodes seek centrally", () => {
  expect(
    readRutubeEvent(
      JSON.stringify({ type: rutubeProtocol.events.time, data: { time: 30 } }),
    ),
  ).toEqual({ kind: "time", position: 30 });
  expect(
    readRutubeEvent({
      type: rutubeProtocol.events.state,
      data: { state: "paused" },
    }),
  ).toEqual({ kind: "state", playing: false });
  expect(
    readRutubeEvent({ type: rutubeProtocol.events.time, data: { time: -1 } }),
  ).toBeNull();
  expect(readRutubeEvent("bad json")).toBeNull();
  expect(JSON.parse(rutubeCommand("seek", 50))).toEqual({
    type: "player:setCurrentTime",
    data: { time: 50 },
  });
});

it("decodes timed VTT and SRT cues and bounds the source", () => {
  expect(
    parseSubtitles(
      Buffer.from(
        "WEBVTT\n\n00:15.100 --> 00:16.200 align:start\n<v Автор>Текст</v>",
      ),
      100,
    ),
  ).toEqual([{ fromSec: 15.1, toSec: 16.2, text: "Текст" }]);
  expect(
    parseSubtitles(
      Buffer.from("1\r\n00:00:10,000 --> 00:00:11,500\r\nФраза"),
      100,
    ),
  ).toEqual([{ fromSec: 10, toSec: 11.5, text: "Фраза" }]);
  expect(() => parseSubtitles(Buffer.from("WEBVTT"), 100)).toThrow();
  expect(() =>
    parseSubtitles(Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nФраза"), 10),
  ).toThrow();
});
