import { expect, test } from "vitest";
import { loadDentalDemo } from "../../scripts/preview/dental-demo";
import { gapDefinition, gradeAnswer } from "../../lib/exercises";
test("dental draft has protected illustrations, sourced questions and all answer types", async () => {
  const lesson = await loadDentalDemo([
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ]);
  expect(lesson.parsed.errors).toEqual([]);
  expect(lesson.parsed.images).toHaveLength(2);
  expect(lesson.parsed.gaps).toHaveLength(10);
  expect(lesson.questions).toHaveLength(6);
  expect(new Set(lesson.questions.map((q) => q.answerType)).size).toBe(3);
  for (const q of lesson.questions)
    expect(
      lesson.parsed.blocks.some((b) => b.blockKey === q.sourceBlockKey),
    ).toBe(true);
  const gap = lesson.parsed.gaps.find((g) => g.answerType === "SHORT_TEXT")!;
  expect(
    gradeAnswer(gapDefinition(gap, lesson.exercises[gap.gapKey]), {
      text: "3.6",
    }).isCorrect,
  ).toBe(true);
  expect(lesson.markdown).toContain("со стороны пациента");
});
