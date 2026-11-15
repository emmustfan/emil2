import { expect, it } from "vitest";
import { diffLines, diffQuestions } from "../../lib/content/diff";
import type { QuestionDTO } from "../../lib/content/types";
it("compares lines using LCS including insertions, removals and repeated lines", () => {
  expect(diffLines("a\nb\na", "a\nc\na")).toEqual([
    { kind: "same", text: "a" },
    { kind: "removed", text: "b" },
    { kind: "added", text: "c" },
    { kind: "same", text: "a" },
  ]);
  expect(diffLines("", "a")).toEqual([{ kind: "added", text: "a" }]);
  expect(diffLines("a", "")).toEqual([{ kind: "removed", text: "a" }]);
  expect(diffLines("", "")).toEqual([]);
  expect(diffLines("a\n", "a\n")).toEqual([
    { kind: "same", text: "a" },
    { kind: "same", text: "" },
  ]);
});
it("reconstructs both inputs, including large bounded comparisons", () => {
  const inputs = [
    ["a\nb\na\nc", "b\na\nd\nc"],
    [
      Array.from({ length: 1100 }, (_, i) => `old${i}`).join("\n"),
      Array.from({ length: 1100 }, (_, i) => `new${i}`).join("\n"),
    ],
  ];
  for (const [before, after] of inputs) {
    const diff = diffLines(before, after);
    expect(
      diff
        .filter((l) => l.kind !== "added")
        .map((l) => l.text)
        .join("\n"),
    ).toBe(before);
    expect(
      diff
        .filter((l) => l.kind !== "removed")
        .map((l) => l.text)
        .join("\n"),
    ).toBe(after);
  }
});
const q: QuestionDTO = {
  id: "one",
  topicId: "topic",
  answerType: "SINGLE_CHOICE",
  stem: "Question",
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  correctOptionIds: ["a"],
  acceptedAnswers: [],
  explanation: "Reason",
  sourceBlockKey: null,
  isDiagnostic: false,
  order: 0,
};
it("reports question additions, edits and deletions and ignores draft bookkeeping", () => {
  expect(
    diffQuestions([q], [{ ...q, hasDraft: true, publishedAt: null }]),
  ).toEqual([]);
  expect(
    diffQuestions(
      [q, { ...q, id: "deleted" }],
      [
        { ...q, explanation: "Changed" },
        { ...q, id: "new" },
      ],
    ).map((c) => c.kind),
  ).toEqual(["removed", "changed", "added"]);
  expect(
    diffQuestions([q], [{ ...q, correctOptionIds: ["b"] }])[0].before,
  ).toEqual(q);
});
