import type { QuestionDTO } from "./types";

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** LCS on lines; bounded middle matrix keeps very large pasted lessons safe. */
export function diffLines(before: string, after: string): DiffLine[] {
  if (before === after)
    return before
      ? before.split("\n").map((text) => ({ kind: "same", text }))
      : [];
  const a = before ? before.split("\n") : [],
    b = after ? after.split("\n") : [];
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++;
  const left = a.slice(start, a.length - end),
    right = b.slice(start, b.length - end);
  const result: DiffLine[] = a
    .slice(0, start)
    .map((text) => ({ kind: "same", text }));
  if ((left.length + 1) * (right.length + 1) > 1_000_000) {
    for (const text of left) result.push({ kind: "removed", text });
    for (const text of right) result.push({ kind: "added", text });
  } else {
    const width = right.length + 1,
      matrix = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--)
      for (let j = right.length - 1; j >= 0; j--)
        matrix[i * width + j] =
          left[i] === right[j]
            ? matrix[(i + 1) * width + j + 1] + 1
            : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        result.push({ kind: "same", text: left[i++] });
        j++;
      } else if (
        i < left.length &&
        (j >= right.length ||
          matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])
      )
        result.push({ kind: "removed", text: left[i++] });
      else result.push({ kind: "added", text: right[j++] });
    }
  }
  return result.concat(
    a.slice(a.length - end).map((text): DiffLine => ({ kind: "same", text })),
  );
}

function content(question: QuestionDTO) {
  const {
    answerType,
    acceptedAnswers,
    stem,
    options,
    correctOptionIds,
    explanation,
    sourceBlockKey,
    isDiagnostic,
    order,
  } = question;
  return {
    answerType,
    acceptedAnswers,
    stem,
    options,
    correctOptionIds,
    explanation,
    sourceBlockKey,
    isDiagnostic,
    order,
  };
}
export type QuestionChange = {
  kind: "removed" | "added" | "changed";
  before: QuestionDTO | null;
  after: QuestionDTO | null;
};
export function diffQuestions(
  before: QuestionDTO[],
  after: QuestionDTO[],
): QuestionChange[] {
  const previous = new Map(before.map((q) => [q.id, q]));
  const current = new Map(after.map((q) => [q.id, q]));
  const changes: QuestionChange[] = [];
  for (const q of before)
    if (!current.has(q.id))
      changes.push({ kind: "removed", before: q, after: null });
  for (const q of after) {
    const old = previous.get(q.id);
    if (!old) changes.push({ kind: "added", before: null, after: q });
    else if (JSON.stringify(content(old)) !== JSON.stringify(content(q)))
      changes.push({ kind: "changed", before: old, after: q });
  }
  return changes;
}
