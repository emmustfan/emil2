import { decodeSetting } from "../../lib/settings/defaults";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseTopic } from "../../lib/content/parse";
import {
  completedLesson,
  optionsFromJSON,
  publicBlocks,
  shuffledOptions,
} from "../../lib/lessons/public";
import {
  SafeMarkdown,
  LessonMarkdown,
} from "../../components/lessons/markdown";
import { gapAnswerInput, testAnswerInput } from "../../lib/lessons/http";
const md =
  "## Тест\n\nТолько [[секретный-ответ|ошибка|другой]] вариант.\n\nСКРЫТЫЙ_ПЛАТНЫЙ_АБЗАЦ.";
describe("public lesson data", () => {
  it("replaces raw gap markup and does not expose gap hashes, answer order or source offsets", () => {
    const parsed = parseTopic(md),
      blocks = publicBlocks(md, new Map([[parsed.gaps[0].gapKey, "gap-1"]]));
    expect(blocks[1].markdown).toBe(
      "Только [____](#lesson-gap-gap-1) вариант.",
    );
    expect(JSON.stringify(blocks)).not.toContain("секретный-ответ");
    expect(JSON.stringify(blocks)).not.toContain(parsed.gaps[0].gapKey);
  });
  it("cuts paid previews on the server and strips options from their gaps", () => {
    const result = JSON.stringify(publicBlocks(md, new Map(), 2));
    expect(result).toContain("____");
    for (const secret of [
      "секретный-ответ",
      "ошибка",
      "СКРЫТЫЙ_ПЛАТНЫЙ_АБЗАЦ",
      "[[",
    ])
      expect(result).not.toContain(secret);
  });
  it("shuffles independently of input order and stably for each actor/gap", () => {
    const values = ["да", "нет", "возможно"];
    const first = shuffledOptions(values, "demo:one", "gap");
    expect(first).toEqual(
      shuffledOptions([...values].reverse(), "demo:one", "gap"),
    );
    expect(first).toEqual(shuffledOptions(values, "demo:one", "gap"));
    expect(first.map((o) => o.id)).not.toEqual(
      shuffledOptions(values, "demo:two", "gap").map((o) => o.id),
    );
    expect(new Set(first.map((o) => o.text))).toEqual(new Set(values));
    expect(Object.keys(first[0]).sort()).toEqual(["id", "text"]);
  });
  it("requires all gaps and the configured passing best score", () => {
    expect(completedLesson(2, 2, 0.7, 0.7)).toBe(true);
    expect(completedLesson(1, 2, 1, 0.7)).toBe(false);
    expect(completedLesson(2, 2, 0.69, 0.7)).toBe(false);
    expect(completedLesson(2, 2, null, 0.7)).toBe(false);
  });
  it("allowlists option fields and rejects forged or oversized input", () => {
    expect(decodeSetting("lesson.guestDays", 366)).toBe(30);
    expect(decodeSetting("lesson.requestsPerMinute", 1.5)).toBe(120);
    expect(decodeSetting("lesson.paywallPreviewBlocks", 2.5)).toBe(2);
    expect(decodeSetting("lesson.requestsPerMinute", 60)).toBe(60);
    expect(
      optionsFromJSON([{ id: "a", text: "A", correct: true }, null, {}]),
    ).toEqual([{ id: "a", text: "A" }]);
    expect(
      gapAnswerInput.safeParse({ optionId: "correct", version: 1 }).success,
    ).toBe(false);
    expect(
      gapAnswerInput.safeParse({
        optionId: "a".repeat(64),
        version: 1,
        isCorrect: true,
      }).success,
    ).toBe(false);
    expect(
      testAnswerInput.safeParse({
        runId: "r",
        questionId: "q",
        chosenId: "a",
        userId: "other",
      }).success,
    ).toBe(false);
  });
  it("sanitizes links/HTML, supports tables/callouts and renders stable source anchors", () => {
    const html = renderToStaticMarkup(
      <LessonMarkdown
        blocks={[
          {
            blockKey: "intro-1",
            markdown:
              "> [!remember] Запись\n\n| A | B |\n| - | - |\n| x | y |\n\n<script>alert(1)</script>\n\n[опасно](javascript:alert)",
          },
        ]}
      />,
    );
    expect(html).toContain('id="b-intro-1"');
    expect(html).toContain("Запомните");
    expect(html).toContain("<table");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(
      renderToStaticMarkup(
        <SafeMarkdown
          markdown="[____](#lesson-gap-id)"
          gap={(id) => <button>{id}</button>}
        />,
      ),
    ).toContain("<button>id</button>");
  });
});
